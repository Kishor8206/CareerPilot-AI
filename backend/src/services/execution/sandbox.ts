import { randomBytes } from 'crypto';
import type { Readable, Writable } from 'stream';

/**
 * The sandbox protocol: how the API server talks to an isolated runner.
 *
 * This module never runs student code. It streams files and test inputs to a
 * process supplied by a `SandboxTransport` (in production: a locked-down Docker
 * container, see dockerRunner.ts) and reads back what happened.
 *
 * Two properties matter for security:
 *
 *  1. Expected outputs never enter the sandbox. Only inputs are sent; the
 *     comparison happens on the host (judge.service.ts). Code running in the
 *     sandbox therefore cannot read the answers.
 *
 *  2. Test inputs are streamed one at a time, each only after the previous
 *     test has finished. While a public test runs, the hidden tests' inputs do
 *     not exist anywhere inside the sandbox.
 */

export interface SandboxLimits {
  /** Hard memory ceiling for the whole sandbox, in MB. */
  memoryMb: number;
  cpus: number;
  maxProcesses: number;
}

export interface SandboxProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  /** Resolves with the exit code once the process has ended (null if it was killed by a signal). */
  exited: Promise<number | null>;
  /** Forcefully stops the sandbox and releases its resources. Safe to call more than once. */
  kill(): void;
}

export interface SandboxTransport {
  readonly name: string;
  start(limits: SandboxLimits): SandboxProcess;
  /** Turns a start-up failure into a typed error (e.g. "Docker is not running"). */
  explainFailure?(exitCode: number | null, stderr: string): SandboxError | null;
}

export type SandboxErrorKind = 'UNAVAILABLE' | 'TIMEOUT' | 'PROTOCOL';

export class SandboxError extends Error {
  constructor(
    public readonly kind: SandboxErrorKind,
    /** Safe to show to a student: no paths, no stack traces, no host details. */
    public readonly publicMessage: string,
    internalDetail?: string,
  ) {
    super(internalDetail ?? publicMessage);
    this.name = 'SandboxError';
  }
}

export interface RawTestRun {
  exitCode: number;
  timeMs: number;
  memoryKb: number;
  /** Raw JSON text the harness wrote, or null if it never produced a result. */
  result: string | null;
  stdout: string;
  stderr: string;
  /** The host had to stop the test because the sandbox did not enforce the limit itself. */
  hostTimedOut?: boolean;
  /** The sandbox was killed by the kernel's out-of-memory handling. */
  oomKilled?: boolean;
}

export interface RawRunReport {
  compile: { ok: boolean; output: string };
  /** One entry per test that actually ran, in order. May be shorter than the input list. */
  tests: RawTestRun[];
}

export interface SandboxJob {
  files: Array<{ name: string; content: string }>;
  /** Shell snippets; see languages.ts. Must not contain single quotes. */
  compileCommand: string;
  runCommand: string;
  compileTimeoutMs: number;
  /** Per-test limit enforced inside the sandbox. */
  testTimeoutMs: number;
  inputs: string[];
  limits: SandboxLimits;
  /** Return false to stop after a test (e.g. after a time-limit failure). */
  shouldContinue?: (run: RawTestRun, index: number) => boolean;
}

/**
 * Bootstrap passed as the sandbox's command. It receives files over stdin
 * (`F <name> <bytes>` followed by exactly that many raw bytes), then hands
 * control, and the rest of stdin, to the runner script.
 */
export const SANDBOX_LOADER =
  'umask 077; while IFS=" " read -r k n b; do case "$k" in ' +
  'F) head -c "$b" > "./$n" ;; G) break ;; *) exit 97 ;; esac; done; exec sh ./run.sh';

const SCRIPT_NAME = 'run.sh';
const SAFE_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

function seconds(ms: number): string {
  return (Math.max(100, ms) / 1000).toFixed(3);
}

/**
 * The runner script executed inside the sandbox. POSIX sh only.
 *
 * Every line it reports is prefixed with a random nonce. The student program's
 * own stdout and stderr go to files, never to the report stream.
 */
export function buildRunnerScript(job: Pick<SandboxJob, 'compileCommand' | 'runCommand' | 'compileTimeoutMs' | 'testTimeoutMs'>, nonce: string, resultFile: string): string {
  for (const command of [job.compileCommand, job.runCommand]) {
    if (command.includes("'")) throw new Error('Sandbox commands must not contain single quotes');
  }
  const compileLimit = seconds(job.compileTimeoutMs);
  const runLimit = seconds(job.testTimeoutMs);

  return `N='${nonce}'
emit() { printf '%s %s\\n' "$N" "$*"; }
enc() { if [ -s "$2" ]; then head -c "$1" "$2" | base64 | tr -d '\\n\\r'; else printf '%s' '-'; fi; }
now() { date +%s%N; }

timeout -k 1 ${compileLimit} sh -c '${job.compileCommand}' > c.txt 2>&1 < /dev/null
rc=$?
emit C "$rc" "$(enc 16384 c.txt)"
rm -f c.txt
if [ "$rc" -ne 0 ]; then emit D; exit 0; fi

while IFS=' ' read -r kind idx size; do
  case "$kind" in
    T)
      head -c "$size" > in.txt
      rm -f ${resultFile} out.txt err.txt mem.txt
      s=$(now)
      if [ -x /usr/bin/time ]; then
        /usr/bin/time -q -f '%M' -o mem.txt timeout -k 1 ${runLimit} sh -c '${job.runCommand}' < in.txt > out.txt 2> err.txt
      else
        timeout -k 1 ${runLimit} sh -c '${job.runCommand}' < in.txt > out.txt 2> err.txt
      fi
      rc=$?
      e=$(now)
      ms=$(( (e - s) / 1000000 ))
      kb=0
      if [ -s mem.txt ]; then kb=$(tail -n 1 mem.txt | tr -cd '0-9'); fi
      if [ -z "$kb" ]; then kb=0; fi
      emit T "$idx" "$rc" "$ms" "$kb" "$(enc 262144 ${resultFile})" "$(enc 65536 out.txt)" "$(enc 16384 err.txt)"
      rm -f in.txt
      ;;
    *) break ;;
  esac
done
emit D
`;
}

/** Reads newline-terminated lines from a stream, with a per-line deadline. */
class LineReader {
  private buffer = '';
  private lines: string[] = [];
  private waiter: ((line: string | null) => void) | null = null;
  private ended = false;
  private total = 0;
  overflowed = false;

  constructor(stream: Readable, private readonly maxBytes: number) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      this.total += chunk.length;
      if (this.total > this.maxBytes) {
        this.overflowed = true;
        this.finish();
        return;
      }
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        this.push(this.buffer.slice(0, newline).replace(/\r$/, ''));
        this.buffer = this.buffer.slice(newline + 1);
        newline = this.buffer.indexOf('\n');
      }
    });
    stream.on('end', () => this.finish());
    stream.on('close', () => this.finish());
    stream.on('error', () => this.finish());
  }

  private push(line: string): void {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(line);
    } else {
      this.lines.push(line);
    }
  }

  private finish(): void {
    this.ended = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(null);
    }
  }

  /** Resolves with the next line, `null` at end of stream, or `'timeout'`. */
  next(timeoutMs: number): Promise<string | null | 'timeout'> {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        resolve('timeout');
      }, timeoutMs);
      this.waiter = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
    });
  }
}

function decode(field: string | undefined): string {
  if (!field || field === '-') return '';
  return Buffer.from(field, 'base64').toString('utf8');
}

function writeAll(stdin: Writable, data: string): void {
  if (!stdin.destroyed && stdin.writable) stdin.write(data);
}

const MAX_REPORT_BYTES = 24 * 1024 * 1024;
/** Slack between the sandbox's own limit and the host giving up on a step. */
const HOST_GRACE_MS = 8000;

/**
 * Runs one job in a sandbox and returns the raw outcome of each test.
 * Throws `SandboxError` when the sandbox itself failed; a failing *program* is
 * a normal return value.
 */
export async function runInSandbox(transport: SandboxTransport, job: SandboxJob, resultFile: string): Promise<RawRunReport> {
  for (const file of job.files) {
    if (!SAFE_FILE_NAME.test(file.name) || file.name === SCRIPT_NAME) {
      throw new SandboxError('PROTOCOL', 'The code sandbox rejected the submission.', `unsafe file name ${file.name}`);
    }
  }

  const nonce = randomBytes(12).toString('hex');
  const script = buildRunnerScript(job, nonce, resultFile);
  const proc = transport.start(job.limits);

  let stderrTail = '';
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
  });
  // A sandbox that dies mid-write must not crash the API server.
  proc.stdin.on('error', () => undefined);

  let exitCode: number | null | undefined;
  const exited = proc.exited.then((code) => {
    exitCode = code;
    return code;
  });

  const reader = new LineReader(proc.stdout, MAX_REPORT_BYTES);

  const fail = async (kind: SandboxErrorKind, fallback: string): Promise<never> => {
    proc.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    const explained = transport.explainFailure?.(exitCode ?? null, stderrTail);
    if (explained) throw explained;
    throw new SandboxError(kind, fallback, `${fallback} exit=${exitCode} stderr=${stderrTail.slice(-600)}`);
  };

  /** Next report line carrying our nonce; anything else on the stream is ignored. */
  const nextReport = async (timeoutMs: number): Promise<string[] | null | 'timeout'> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const line = await reader.next(Math.max(1, deadline - Date.now()));
      if (line === null || line === 'timeout') return line;
      if (line.startsWith(`${nonce} `)) return line.slice(nonce.length + 1).split(' ');
    }
  };

  try {
    for (const file of [...job.files, { name: SCRIPT_NAME, content: script }]) {
      writeAll(proc.stdin, `F ${file.name} ${Buffer.byteLength(file.content)}\n${file.content}`);
    }
    writeAll(proc.stdin, 'G\n');

    const compile = await nextReport(job.compileTimeoutMs + HOST_GRACE_MS + 20_000);
    if (compile === 'timeout') return await fail('TIMEOUT', 'The code sandbox did not respond in time.');
    if (compile === null || compile[0] !== 'C') return await fail('PROTOCOL', 'The code sandbox could not be started.');

    const compileExit = Number(compile[1]);
    const compileOutput = decode(compile[2]);
    if (compileExit !== 0) {
      const timedOut = compileExit === 124 || compileExit === 137;
      return {
        compile: { ok: false, output: timedOut ? `Compilation took too long and was stopped.\n${compileOutput}` : compileOutput },
        tests: [],
      };
    }

    const tests: RawTestRun[] = [];
    for (const [index, input] of job.inputs.entries()) {
      writeAll(proc.stdin, `T ${index} ${Buffer.byteLength(input)}\n${input}`);

      const report = await nextReport(job.testTimeoutMs + HOST_GRACE_MS);
      let run: RawTestRun;

      if (report === 'timeout') {
        // The sandbox's own timer failed to stop the program; the host does it.
        run = { exitCode: 124, timeMs: job.testTimeoutMs, memoryKb: 0, result: null, stdout: '', stderr: '', hostTimedOut: true };
        tests.push(run);
        break;
      }
      if (report === null) {
        await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
        if (reader.overflowed) return await fail('PROTOCOL', 'The program produced too much output.');
        if (exitCode === 137) {
          // The kernel killed the sandbox for exceeding its memory ceiling.
          tests.push({ exitCode: 137, timeMs: 0, memoryKb: 0, result: null, stdout: '', stderr: '', oomKilled: true });
          break;
        }
        return await fail('PROTOCOL', 'The code sandbox stopped unexpectedly.');
      }
      if (report[0] !== 'T' || Number(report[1]) !== index) {
        return await fail('PROTOCOL', 'The code sandbox returned an unreadable result.');
      }

      const rawResult = decode(report[5]);
      run = {
        exitCode: Number(report[2]),
        timeMs: Number(report[3]) || 0,
        memoryKb: Number(report[4]) || 0,
        result: report[5] && report[5] !== '-' ? rawResult : null,
        stdout: decode(report[6]),
        stderr: decode(report[7]),
      };
      tests.push(run);

      if (job.shouldContinue && !job.shouldContinue(run, index)) break;
    }

    writeAll(proc.stdin, 'Q\n');
    proc.stdin.end();
    return { compile: { ok: true, output: compileOutput }, tests };
  } finally {
    // Always tear the sandbox down, whatever happened above.
    proc.kill();
  }
}
