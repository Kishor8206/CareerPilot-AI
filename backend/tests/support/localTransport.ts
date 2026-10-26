import { execFileSync, spawn, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SANDBOX_LOADER, type SandboxLimits, type SandboxProcess, type SandboxTransport } from '../../src/services/execution/sandbox';

/**
 * TEST-ONLY transport. It runs the sandbox protocol as a plain local process in
 * a temporary directory, with NO isolation.
 *
 * It exists so the test suite can prove that the generated harnesses, the
 * runner script and the judge agree, using the compilers on the developer's
 * machine, without needing Docker. It is only ever given code that lives in
 * this repository (the reference solutions and the fixtures in the tests).
 *
 * It lives under tests/, is not imported by anything in src/, and cannot be
 * selected by configuration. The application has exactly one way to run
 * student code: the Docker transport.
 */

function findShell(): string | null {
  const candidates = [
    process.env.CP_TEST_SH,
    'C:\\Program Files\\Git\\usr\\bin\\sh.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\sh.exe',
    '/bin/sh',
    '/usr/bin/sh',
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function hasTool(command: string, args: string[]): boolean {
  try {
    return spawnSync(command, args, { stdio: 'ignore', windowsHide: true, timeout: 20_000 }).status === 0;
  } catch {
    return false;
  }
}

/** Directory of a tool on PATH, or null. */
function toolDir(command: string): string | null {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const found = execFileSync(finder, [command], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim();
    return found ? path.dirname(found) : null;
  } catch {
    return null;
  }
}

const SHELL = findShell();
const PYTHON = hasTool('python3', ['--version']) ? 'python3' : 'python';

/** Which languages this machine can run locally. */
export const LOCAL_TOOLCHAINS = {
  shell: SHELL !== null,
  python: SHELL !== null && hasTool(PYTHON, ['--version']),
  javascript: SHELL !== null && hasTool('node', ['--version']),
  cpp: SHELL !== null && hasTool('g++', ['--version']),
  java: SHELL !== null && hasTool('javac', ['-version']) && hasTool('java', ['-version']),
};

export class LocalProcessTransport implements SandboxTransport {
  readonly name = 'local-test';

  start(_limits: SandboxLimits): SandboxProcess {
    if (!SHELL) throw new Error('No POSIX shell available for the local test transport');
    const workDir = mkdtempSync(path.join(tmpdir(), 'cp-judge-test-'));

    const child = spawn(SHELL, ['-c', SANDBOX_LOADER], {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        // The shell's own directory first, so `timeout`, `head` and `base64`
        // resolve to the POSIX tools rather than same-named Windows programs.
        // The compiler's directory comes next: on Windows another toolchain
        // earlier on PATH can otherwise supply incompatible DLLs to it.
        PATH: [path.dirname(SHELL), toolDir('g++'), process.env.PATH ?? ''].filter(Boolean).join(path.delimiter),
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        CP_PYTHON: PYTHON,
      },
    });

    const exited = new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(127));
      child.once('close', (code) => resolve(code));
    });

    let killed = false;
    const kill = (): void => {
      if (killed) return;
      killed = true;
      child.stdin.destroy();
      try {
        if (process.platform === 'win32' && child.pid) {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* already gone */
      }
      void exited.then(() => {
        try {
          rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {
          /* best effort */
        }
      });
    };

    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, exited, kill };
  }
}
