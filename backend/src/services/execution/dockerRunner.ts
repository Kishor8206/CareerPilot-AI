import { execFile, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { env } from '../../config/env';
import { moduleLogger } from '../../config/logger';
import { SANDBOX_LOADER, SandboxError, type SandboxLimits, type SandboxProcess, type SandboxTransport } from './sandbox';

const log = moduleLogger('docker-runner');

/**
 * Runs each submission in its own throw-away Docker container.
 *
 * The only thing this process starts on the host is the `docker` CLI, with a
 * fixed argument list (no shell, no interpolation of student input). Student
 * code is delivered over the container's stdin and exists only inside it.
 *
 * Isolation applied to every container:
 *   --network none                 no network: no internet, no database, no internal services
 *   --read-only + tmpfs /work,/tmp nothing persists; the image cannot be modified
 *   no volumes or bind mounts      the host filesystem is not visible at all
 *   --user 65534:65534             runs as "nobody", never root
 *   --cap-drop ALL                 no Linux capabilities
 *   --security-opt no-new-privileges
 *   --memory / --memory-swap       hard memory ceiling, swap disabled
 *   --cpus                         CPU quota
 *   --pids-limit                   stops fork bombs
 *   --ulimit nofile / core         bounded file descriptors, no core dumps
 *   --rm + explicit `rm -f`        the container is removed whatever happens
 * No `-e` flags are passed, so no host environment variable (and therefore no
 * secret) reaches the container.
 */

/** Environment for the docker CLI itself: only what it needs to find the daemon. */
function dockerCliEnv(): NodeJS.ProcessEnv {
  const keep = [
    'PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'ProgramData', 'ProgramFiles',
    'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG',
    'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR',
  ];
  const out: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    if (process.env[key] !== undefined) out[key] = process.env[key];
  }
  return out;
}

export function buildDockerArgs(name: string, limits: SandboxLimits, image: string): string[] {
  const memory = `${Math.max(32, Math.round(limits.memoryMb))}m`;
  return [
    'run', '--rm', '-i',
    '--name', name,
    '--pull', 'never',
    '--network', 'none',
    '--read-only',
    '--tmpfs', '/work:rw,exec,nosuid,nodev,size=96m,mode=1777',
    '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=64m,mode=1777',
    '--workdir', '/work',
    '--user', '65534:65534',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--memory', memory,
    '--memory-swap', memory,
    '--cpus', String(limits.cpus),
    '--pids-limit', String(limits.maxProcesses),
    '--ulimit', 'nofile=256:256',
    '--ulimit', 'core=0',
    '--init',
    '--log-driver', 'none',
    '--hostname', 'judge',
    image,
    'sh', '-c', SANDBOX_LOADER,
  ];
}

function explainDockerFailure(exitCode: number | null, stderr: string): SandboxError | null {
  const text = stderr.toLowerCase();
  if (/no such image|unable to find image|pull access denied|manifest unknown/.test(text)) {
    return new SandboxError(
      'UNAVAILABLE',
      'The code sandbox image has not been built on the server yet, so your code was not run.',
      `judge image "${env.CODE_RUNNER_IMAGE}" is missing: run "npm run judge:build"`,
    );
  }
  if (/cannot connect to the docker daemon|error during connect|docker daemon is not running|dockerdesktoplinuxengine|the system cannot find the file specified|permission denied while trying to connect/.test(text)) {
    return new SandboxError(
      'UNAVAILABLE',
      'The code sandbox (Docker) is not running on the server, so your code was not run.',
      `docker daemon unreachable: ${stderr.slice(-300)}`,
    );
  }
  if (exitCode === 125 || exitCode === 126 || exitCode === 127) {
    return new SandboxError('UNAVAILABLE', 'The code sandbox could not be started, so your code was not run.', stderr.slice(-400));
  }
  return null;
}

export class DockerTransport implements SandboxTransport {
  readonly name = 'docker';

  start(limits: SandboxLimits): SandboxProcess {
    const name = `cp-judge-${randomBytes(8).toString('hex')}`;
    const child = spawn(env.DOCKER_BIN, buildDockerArgs(name, limits, env.CODE_RUNNER_IMAGE), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: dockerCliEnv(),
      shell: false,
      windowsHide: true,
    });

    let spawnError: Error | null = null;
    const exited = new Promise<number | null>((resolve) => {
      child.once('error', (error) => {
        spawnError = error;
        resolve(127);
      });
      child.once('close', (code) => resolve(code));
    });

    let killed = false;
    const kill = (): void => {
      if (killed) return;
      killed = true;
      if (spawnError) return;
      // `--rm` covers a normal exit; this covers everything else.
      execFile(env.DOCKER_BIN, ['rm', '-f', name], { env: dockerCliEnv(), windowsHide: true, timeout: 15_000 }, () => undefined);
      child.stdin.destroy();
      setTimeout(() => child.kill(), 2000).unref();
    };

    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, exited, kill };
  }

  explainFailure(exitCode: number | null, stderr: string): SandboxError | null {
    if (exitCode === 127 && !stderr) {
      return new SandboxError(
        'UNAVAILABLE',
        'Docker is not installed on the server, so your code was not run.',
        `could not start "${env.DOCKER_BIN}"`,
      );
    }
    return explainDockerFailure(exitCode, stderr);
  }
}

function run(args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string; missing: boolean }> {
  return new Promise((resolve) => {
    execFile(env.DOCKER_BIN, args, { env: dockerCliEnv(), windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
      const missing = Boolean(error && (error as NodeJS.ErrnoException).code === 'ENOENT');
      resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr), missing });
    });
  });
}

export interface DockerStatus {
  available: boolean;
  reason: string | null;
}

let cached: { at: number; status: DockerStatus } | null = null;
const STATUS_TTL_MS = 20_000;

/** Whether Docker and the judge image are ready. Cached briefly; never throws. */
export async function dockerStatus(force = false): Promise<DockerStatus> {
  if (!force && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;

  let status: DockerStatus;
  const version = await run(['version', '--format', '{{.Server.Version}}'], 8000);
  if (version.missing) {
    status = { available: false, reason: 'Docker is not installed on the server.' };
  } else if (!version.ok) {
    status = { available: false, reason: 'Docker is installed but not running on the server.' };
  } else {
    const image = await run(['image', 'inspect', '--format', '{{.Id}}', env.CODE_RUNNER_IMAGE], 8000);
    status = image.ok
      ? { available: true, reason: null }
      : { available: false, reason: 'The code sandbox image has not been built yet (npm run judge:build).' };
  }

  if (!status.available) log.warn({ reason: status.reason }, 'Docker sandbox is not available');
  cached = { at: Date.now(), status };
  return status;
}
