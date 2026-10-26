import type { CodeExecutionResult, CodeSandboxStatusDto, DsaLanguageId } from '@careerpilot/shared';
import { DSA_LANGUAGE_IDS, ErrorCode } from '@careerpilot/shared';
import { env } from '../config/env';
import { moduleLogger } from '../config/logger';
import { ApiError } from '../utils/ApiError';
import { dockerStatus, DockerTransport } from './execution/dockerRunner';
import { judge, type JudgeInput } from './execution/judge.service';
import { isSupportedLanguage } from './execution/languages';
import type { SandboxTransport } from './execution/sandbox';

const log = moduleLogger('code-execution');

/**
 * Code execution for the DSA environment.
 *
 * SECURITY: student code is NEVER executed in this Node process or anywhere on
 * the host. There is no `eval`, `vm`, `Function` or direct interpreter call on
 * submitted code in the application. The only way code runs is inside an
 * isolated sandbox reached through a `SandboxTransport`:
 *
 *   docker    - one locked-down, network-less container per submission
 *               (see execution/dockerRunner.ts).
 *   disabled  - nothing is run. Requests get an honest "not executed" result.
 *
 * When the sandbox is unavailable (Docker not installed, daemon stopped, image
 * not built) the result says so. It is never replaced by a guess: a fabricated
 * verdict would mislead the student and corrupt the readiness score.
 */
export interface CodeExecutionProvider {
  readonly name: string;
  execute(input: JudgeInput): Promise<CodeExecutionResult>;
  status(): Promise<CodeSandboxStatusDto>;
}

export const MAX_CODE_BYTES = 100_000;

function validateSubmission(input: JudgeInput): void {
  if (!input.code || !input.code.trim()) {
    throw ApiError.badRequest('No code was submitted.');
  }
  if (Buffer.byteLength(input.code) > MAX_CODE_BYTES) {
    throw ApiError.payloadTooLarge('Your submission exceeds the 100 KB size limit.');
  }
  if (!isSupportedLanguage(input.language)) {
    throw ApiError.badRequest(`Language "${input.language}" is not supported.`);
  }
  if (!input.publicTests.length && !input.hiddenTests.length) {
    throw ApiError.badRequest('This problem has no test cases configured.');
  }
}

function notExecuted(provider: string, total: number, message: string): CodeExecutionResult {
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

/**
 * Bounds how many sandboxes run at once, so a burst of submissions cannot
 * exhaust the host. Excess requests wait briefly, then are turned away.
 */
class Semaphore {
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly max: number, private readonly maxWaiting: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxWaiting) {
        throw ApiError.serviceUnavailable(
          'The judge is busy right now. Please try again in a few seconds.',
          ErrorCode.CODE_EXECUTION_FAILED,
        );
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

class SandboxExecutionProvider implements CodeExecutionProvider {
  private readonly slots = new Semaphore(env.CODE_RUNNER_MAX_CONCURRENT, 25);

  constructor(
    private readonly transport: SandboxTransport,
    private readonly probe: () => Promise<{ available: boolean; reason: string | null }>,
  ) {}

  get name(): string {
    return this.transport.name;
  }

  async execute(input: JudgeInput): Promise<CodeExecutionResult> {
    validateSubmission(input);
    return this.slots.run(async () => {
      const result = await judge(this.transport, input, {
        cpus: env.CODE_RUNNER_CPUS,
        maxProcesses: env.CODE_RUNNER_PIDS_LIMIT,
      });
      log.info(
        { language: input.language, status: result.status, executed: result.executed, tests: result.totalCount },
        'Judged a submission',
      );
      return result;
    });
  }

  async status(): Promise<CodeSandboxStatusDto> {
    const probe = await this.probe();
    return { available: probe.available, provider: this.name, languages: DSA_LANGUAGE_IDS, reason: probe.reason };
  }
}

/** Runs nothing. Used when execution is switched off by configuration. */
class DisabledExecutionProvider implements CodeExecutionProvider {
  readonly name = 'disabled';
  private readonly reason = 'Code execution is switched off on this server (CODE_EXECUTION_PROVIDER).';

  async execute(input: JudgeInput): Promise<CodeExecutionResult> {
    validateSubmission(input);
    return notExecuted(this.name, input.publicTests.length + input.hiddenTests.length, `${this.reason} Your code was not run.`);
  }

  async status(): Promise<CodeSandboxStatusDto> {
    return { available: false, provider: this.name, languages: DSA_LANGUAGE_IDS as DsaLanguageId[], reason: this.reason };
  }
}

function buildProvider(): CodeExecutionProvider {
  if (env.CODE_EXECUTION_PROVIDER === 'docker') {
    return new SandboxExecutionProvider(new DockerTransport(), () => dockerStatus());
  }
  return new DisabledExecutionProvider();
}

let provider: CodeExecutionProvider = buildProvider();

/** Indirection so the provider can be swapped by the test suite. */
export const codeExecutor: CodeExecutionProvider = {
  get name() {
    return provider.name;
  },
  execute: (input) => provider.execute(input),
  status: () => provider.status(),
};

/**
 * Test-suite hook: judges through a supplied transport instead of Docker.
 * Refuses to work outside NODE_ENV=test, so it can never route real
 * submissions anywhere but the configured sandbox.
 */
export function useSandboxTransportForTests(transport: SandboxTransport | null): void {
  if (!env.isTest) throw new Error('useSandboxTransportForTests is only available under NODE_ENV=test');
  provider = transport
    ? new SandboxExecutionProvider(transport, async () => ({ available: true, reason: null }))
    : buildProvider();
}

log.info({ provider: codeExecutor.name }, 'Code execution provider ready');
