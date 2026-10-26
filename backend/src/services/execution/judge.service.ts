import type {
  CodeExecutionResult, DsaCompareMode, DsaLanguageId, DsaReturnType, DsaSignature, DsaTestCase,
  SubmissionStatus, TestCaseResult,
} from '@careerpilot/shared';
import { buildProgram, encodeArgs, remapLineNumbers, RESULT_FILE, type GeneratedProgram } from './codegen';
import { LANGUAGE_RUNTIMES } from './languages';
import { runInSandbox, SandboxError, type RawRunReport, type RawTestRun, type SandboxJob, type SandboxTransport } from './sandbox';

/**
 * The judge. It alone decides a verdict, and it does so deterministically:
 * the same program and the same tests always produce the same result. No AI
 * model is involved anywhere in this file.
 *
 * It runs on the host, outside the sandbox, which is why it can hold the
 * expected outputs: the code being judged never sees them.
 */

/* ------------------------------------------------------------------ */
/* Output comparison                                                   */
/* ------------------------------------------------------------------ */

const FLOAT_TOLERANCE = 1e-6;

function isFloatType(type: DsaReturnType): boolean {
  return type === 'double';
}

function deepEqual(expected: unknown, actual: unknown, float: boolean): boolean {
  if (typeof expected === 'number') {
    if (typeof actual !== 'number' || !Number.isFinite(actual)) return false;
    if (!float) return expected === actual;
    return Math.abs(expected - actual) <= FLOAT_TOLERANCE * Math.max(1, Math.abs(expected));
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, i) => deepEqual(item, actual[i], float));
  }
  // strings, booleans, null
  return expected === actual;
}

/** A total order over JSON values, so lists can be compared regardless of order. */
function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function sortedCopy(value: unknown, nested: boolean): unknown {
  if (!Array.isArray(value)) return value;
  const items = nested ? value.map((item) => sortedCopy(item, false)) : [...value];
  return items.sort((a, b) => {
    const x = canonical(a);
    const y = canonical(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/**
 * Compares a returned value with the expected one.
 *
 * Both sides are parsed JSON, so formatting differences (spacing, trailing
 * newlines, `1` vs `1.0`) can never cause a wrong verdict.
 */
export function outputsMatch(
  expected: unknown,
  actual: unknown,
  returnType: DsaReturnType,
  mode: DsaCompareMode = 'exact',
): boolean {
  const float = isFloatType(returnType);
  if (mode === 'exact') return deepEqual(expected, actual, float);
  const nested = mode === 'unorderedNested';
  return deepEqual(sortedCopy(expected, nested), sortedCopy(actual, nested), float);
}

/* ------------------------------------------------------------------ */
/* Verdicts                                                            */
/* ------------------------------------------------------------------ */

const OUT_OF_MEMORY = /OutOfMemoryError|MemoryError|std::bad_alloc|heap out of memory|Allocation failed|Cannot allocate memory|out of memory/i;

function parseResult(raw: string | null): { ok: true; value: unknown } | { ok: false } {
  if (raw === null) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/** Classifies one finished test. Pure function of what the sandbox reported. */
export function classifyRun(
  run: RawTestRun,
  test: DsaTestCase,
  returnType: DsaReturnType,
  compareMode: DsaCompareMode,
  effectiveTimeLimitMs: number,
): { status: SubmissionStatus; actual: unknown } {
  if (run.hostTimedOut || run.exitCode === 124 || (run.exitCode === 137 && run.timeMs >= effectiveTimeLimitMs)) {
    return { status: 'TIME_LIMIT_EXCEEDED', actual: undefined };
  }
  if (run.oomKilled || run.exitCode === 137 || (run.exitCode !== 0 && OUT_OF_MEMORY.test(run.stderr))) {
    return { status: 'MEMORY_LIMIT_EXCEEDED', actual: undefined };
  }
  if (run.exitCode !== 0) return { status: 'RUNTIME_ERROR', actual: undefined };

  const parsed = parseResult(run.result);
  // The program ended normally without the harness recording a return value
  // (for example it called exit() itself). That is not an answer.
  if (!parsed.ok) return { status: 'RUNTIME_ERROR', actual: undefined };

  return {
    status: outputsMatch(test.expected, parsed.value, returnType, compareMode) ? 'ACCEPTED' : 'WRONG_ANSWER',
    actual: parsed.value,
  };
}

/* ------------------------------------------------------------------ */
/* Judging a submission                                                */
/* ------------------------------------------------------------------ */

export interface JudgeProblem {
  functionName: string;
  signature: DsaSignature;
  compareMode: DsaCompareMode;
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface JudgeInput {
  problem: JudgeProblem;
  language: DsaLanguageId;
  code: string;
  publicTests: DsaTestCase[];
  /** Empty for "Run". Never echoed back in any form. */
  hiddenTests: DsaTestCase[];
}

export interface JudgeConfig {
  cpus: number;
  maxProcesses: number;
}

const MAX_SHOWN = 4000;

function clip(text: string, max = MAX_SHOWN): string {
  return text.length > max ? `${text.slice(0, max)}\n… (output truncated)` : text;
}

/** Formats a JSON value the way a problem statement writes it. */
export function formatValue(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value);
}

function describeInputs(signature: DsaSignature, test: DsaTestCase): Array<{ name: string; value: string }> {
  return signature.params.map((param, i) => ({ name: param.name, value: formatValue(test.args[i]) }));
}

function unavailable(provider: string, total: number, message: string): CodeExecutionResult {
  return {
    status: 'INTERNAL_ERROR',
    provider,
    executed: false,
    passedCount: 0,
    totalCount: total,
    results: [],
    runtimeMs: 0,
    totalExecutionTimeMs: 0,
    peakMemoryKb: 0,
    message,
  };
}

/** A missing return value with a zero exit code needs an explanation; other failures bring their own. */
function runtimeNote(run: RawTestRun): string | undefined {
  if (run.exitCode === 0 && run.result === null) {
    return 'The program ended without returning a value from the function.';
  }
  return undefined;
}

/**
 * Builds the program, runs it against the tests in the sandbox and returns the
 * verdict. Hidden tests contribute only "passed / failed", their status and
 * timing: never their input, expected output, actual output or prints.
 */
export async function judge(transport: SandboxTransport, input: JudgeInput, config: JudgeConfig): Promise<CodeExecutionResult> {
  const { problem, language } = input;
  const runtime = LANGUAGE_RUNTIMES[language];
  const tests = [
    ...input.publicTests.map((test) => ({ test, hidden: false })),
    ...input.hiddenTests.map((test) => ({ test, hidden: true })),
  ];
  const total = tests.length;

  let program: GeneratedProgram;
  let inputs: string[];
  try {
    program = buildProgram(problem.functionName, problem.signature, language, input.code);
    inputs = tests.map(({ test }) => encodeArgs(problem.signature, test.args));
  } catch {
    // A malformed problem definition is our fault, not the student's.
    return unavailable(transport.name, total, 'This problem is misconfigured and cannot be judged right now.');
  }

  const effectiveTimeLimitMs = Math.round(problem.timeLimitMs * runtime.timeFactor);
  const job: SandboxJob = {
    files: [{ name: program.fileName, content: program.source }],
    compileCommand: runtime.compileCommand,
    runCommand: runtime.runCommand(problem.memoryLimitMb),
    compileTimeoutMs: runtime.compileTimeoutMs,
    testTimeoutMs: effectiveTimeLimitMs,
    inputs,
    limits: {
      memoryMb: runtime.sandboxMemoryMb(problem.memoryLimitMb),
      cpus: config.cpus,
      maxProcesses: config.maxProcesses,
    },
    // A program that hangs or exhausts memory will do so on every later test
    // too; stopping bounds the total time one submission can occupy a sandbox.
    shouldContinue: (run) => {
      const { status } = classifyRun(run, { args: [], expected: null }, problem.signature.returnType, 'exact', effectiveTimeLimitMs);
      return status !== 'TIME_LIMIT_EXCEEDED' && status !== 'MEMORY_LIMIT_EXCEEDED';
    },
  };

  let report: RawRunReport;
  try {
    report = await runInSandbox(transport, job, RESULT_FILE);
  } catch (error) {
    if (error instanceof SandboxError) return unavailable(transport.name, total, error.publicMessage);
    throw error;
  }

  if (!report.compile.ok) {
    return {
      status: 'COMPILATION_ERROR',
      provider: transport.name,
      executed: true,
      passedCount: 0,
      totalCount: total,
      results: [],
      compileOutput: clip(remapLineNumbers(report.compile.output, language, program)) || 'Compilation failed.',
      runtimeMs: 0,
      totalExecutionTimeMs: 0,
      peakMemoryKb: 0,
    };
  }

  const results: TestCaseResult[] = [];
  let verdict: SubmissionStatus = 'ACCEPTED';
  let message: string | undefined;

  for (const [index, run] of report.tests.entries()) {
    const { test, hidden } = tests[index];
    const { status, actual } = classifyRun(run, test, problem.signature.returnType, problem.compareMode, effectiveTimeLimitMs);
    const passed = status === 'ACCEPTED';

    // The verdict of a submission is the verdict of its first failing test.
    if (!passed && verdict === 'ACCEPTED') {
      verdict = status;
      if (status === 'RUNTIME_ERROR') message = runtimeNote(run);
    }

    const base: TestCaseResult = {
      index,
      hidden,
      passed,
      status,
      executionTimeMs: Math.min(run.timeMs, effectiveTimeLimitMs),
      memoryKb: run.memoryKb,
    };

    results.push(
      hidden
        ? base
        : {
            ...base,
            inputs: describeInputs(problem.signature, test),
            expected: formatValue(test.expected),
            actual: actual === undefined ? null : formatValue(actual),
            stdout: clip(run.stdout),
            stderr: clip(remapLineNumbers(run.stderr, language, program)),
          },
    );
  }

  const passedCount = results.filter((r) => r.passed).length;
  const times = results.map((r) => r.executionTimeMs);

  // Accepted requires every test to have run and passed. If the sandbox
  // reported fewer tests than were sent without a failure, something is wrong
  // with the run itself, and that must never read as a pass.
  if (verdict === 'ACCEPTED' && results.length !== total) {
    return unavailable(transport.name, total, 'The judge could not complete this run. Please try again.');
  }

  return {
    status: verdict,
    provider: transport.name,
    executed: true,
    passedCount,
    totalCount: total,
    results,
    runtimeMs: times.length ? Math.max(...times) : 0,
    totalExecutionTimeMs: times.reduce((a, b) => a + b, 0),
    peakMemoryKb: results.length ? Math.max(...results.map((r) => r.memoryKb)) : 0,
    message,
  };
}
