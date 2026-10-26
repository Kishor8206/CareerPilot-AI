/**
 * Verifies the Docker sandbox end to end on THIS machine.
 *
 *   npm run judge:build     (once, builds the image)
 *   npm run judge:verify
 *
 * It needs no database. It judges the bundled reference solutions in every
 * language through real containers, then runs deliberately hostile programs
 * and checks that the sandbox contains each one. Exit code 0 means every check
 * passed.
 */
import { DSA_LANGUAGE_IDS, type DsaLanguageId, type SubmissionStatus } from '@careerpilot/shared';
import { DSA_PROBLEMS, DSA_REFERENCE_SOLUTIONS } from '@careerpilot/database';
import { env } from '../config/env';
import { buildProblemDocument } from '../services/coding.service';
import { dockerStatus, DockerTransport } from '../services/execution/dockerRunner';
import { judge, type JudgeInput } from '../services/execution/judge.service';

const transport = new DockerTransport();
const config = { cpus: env.CODE_RUNNER_CPUS, maxProcesses: env.CODE_RUNNER_PIDS_LIMIT };

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

function inputFor(title: string, language: DsaLanguageId, code: string, publicOnly = false): JudgeInput {
  const doc = buildProblemDocument(DSA_PROBLEMS.find((p) => p.title === title)!);
  return {
    problem: {
      functionName: doc.functionName,
      signature: doc.signature,
      compareMode: doc.compareMode,
      timeLimitMs: doc.timeLimitMs,
      memoryLimitMb: doc.memoryLimitMb,
    },
    language,
    code,
    publicTests: doc.testCases,
    hiddenTests: publicOnly ? [] : doc.hiddenTestCases,
  };
}

/** A Python Two Sum whose body is replaced by a probe; the probe's prints are read back. */
const probe = (body: string) =>
  `class Solution:\n    def twoSum(self, nums, target):\n${body.split('\n').map((line) => `        ${line}`).join('\n')}\n        return [0, 1]\n`;

async function expectVerdict(label: string, input: JudgeInput, expected: SubmissionStatus): Promise<void> {
  const result = await judge(transport, input, config);
  check(label, result.status === expected, `got ${result.status}${result.message ? `: ${result.message}` : ''}`);
}

async function probeOutput(body: string): Promise<string> {
  const result = await judge(transport, inputFor('Two Sum', 'python', probe(body), true), config);
  return `${result.results[0]?.stdout ?? ''}${result.results[0]?.stderr ?? ''}`.trim();
}

async function main(): Promise<void> {
  console.log('\nCareerPilot AI - DSA judge verification\n');

  const status = await dockerStatus(true);
  if (!status.available) {
    console.log(`The sandbox is not available: ${status.reason}`);
    console.log('Install and start Docker Desktop, run "npm run judge:build", then run this again.\n');
    process.exit(2);
  }
  console.log(`Docker is running and image "${env.CODE_RUNNER_IMAGE}" exists.\n`);

  console.log('1. Reference solutions must be Accepted in every language');
  const full = process.argv.includes('--all');
  const titles = full
    ? DSA_PROBLEMS.map((p) => p.title)
    : ['Two Sum', 'Valid Palindrome', 'Maximum Average Subarray', 'Merge Two Sorted Lists', 'Invert Binary Tree', 'Group Anagrams', 'Fibonacci Number'];
  for (const language of DSA_LANGUAGE_IDS) {
    for (const title of titles) {
      const result = await judge(transport, inputFor(title, language, DSA_REFERENCE_SOLUTIONS[title][language]), config);
      check(`${language.padEnd(10)} ${title}`, result.status === 'ACCEPTED', `${result.status} ${result.passedCount}/${result.totalCount} ${result.runtimeMs}ms ${Math.round(result.peakMemoryKb / 1024)}MB`);
    }
  }

  console.log('\n2. Verdicts');
  await expectVerdict('Wrong Answer', inputFor('Two Sum', 'python', probe('pass')), 'WRONG_ANSWER');
  await expectVerdict('Runtime Error', inputFor('Two Sum', 'python', probe('return nums[10 ** 6]')), 'RUNTIME_ERROR');
  await expectVerdict('Compilation Error (C++)', inputFor('Two Sum', 'cpp', 'class Solution { public: vector<int> twoSum(vector<int>& n, int t) { return nope; } };'), 'COMPILATION_ERROR');
  await expectVerdict('Time Limit Exceeded (Python)', inputFor('Two Sum', 'python', probe('while True: pass')), 'TIME_LIMIT_EXCEEDED');
  await expectVerdict('Time Limit Exceeded (C++)', inputFor('Two Sum', 'cpp', 'class Solution { public: vector<int> twoSum(vector<int>& n, int t) { volatile long x = 0; while (true) x++; return {}; } };'), 'TIME_LIMIT_EXCEEDED');
  await expectVerdict('Memory Limit Exceeded (Python)', inputFor('Two Sum', 'python', probe('data = []\nwhile True: data.append(bytearray(16 * 1024 * 1024))')), 'MEMORY_LIMIT_EXCEEDED');
  await expectVerdict('Memory Limit Exceeded (Java)', inputFor('Two Sum', 'java', 'class Solution { public int[] twoSum(int[] n, int t) { List<long[]> d = new ArrayList<>(); while (true) d.add(new long[4 * 1024 * 1024]); } }'), 'MEMORY_LIMIT_EXCEEDED');
  await expectVerdict('Memory Limit Exceeded (C++)', inputFor('Two Sum', 'cpp', 'class Solution { public: vector<int> twoSum(vector<int>& n, int t) { vector<vector<long long>> d; while (true) d.emplace_back(4 * 1024 * 1024, 1LL); return {}; } };'), 'MEMORY_LIMIT_EXCEEDED');
  await expectVerdict('Memory Limit Exceeded (JavaScript)', inputFor('Two Sum', 'javascript', 'var twoSum = function(n, t) { const d = []; while (true) d.push(new Array(1e6).fill(1)); };'), 'MEMORY_LIMIT_EXCEEDED');

  console.log('\n3. Isolation (each probe runs inside the sandbox and reports what it could do)');
  const network = await probeOutput(
    'import socket\ntry:\n    socket.create_connection(("1.1.1.1", 53), timeout=3)\n    print("NETWORK-OPEN")\nexcept Exception as e:\n    print("blocked", type(e).__name__)',
  );
  check('No network access', network.includes('blocked') && !network.includes('NETWORK-OPEN'), network);

  const dns = await probeOutput(
    'import socket\ntry:\n    socket.gethostbyname("host.docker.internal")\n    print("HOST-RESOLVED")\nexcept Exception as e:\n    print("blocked", type(e).__name__)',
  );
  check('Host and internal services are unreachable', dns.includes('blocked'), dns);

  const user = await probeOutput('import os\nprint("uid", os.getuid(), "gid", os.getgid())');
  check('Runs as a non-root user', user.includes('uid 65534'), user);

  const rootfs = await probeOutput(
    'try:\n    open("/etc/cp-probe", "w").write("x")\n    print("ROOTFS-WRITABLE")\nexcept Exception as e:\n    print("blocked", type(e).__name__)',
  );
  check('Root filesystem is read-only', rootfs.includes('blocked'), rootfs);

  const secrets = await probeOutput(
    'import os\nleaked = [k for k in os.environ if any(w in k.upper() for w in ("SECRET", "TOKEN", "KEY", "MONGO", "PASSWORD", "JWT"))]\nprint("leaked", leaked)',
  );
  check('No secrets in the environment', secrets.includes('leaked []'), secrets);

  const mounts = await probeOutput(
    'import os\nprint("host-paths", [p for p in ("/host", "/mnt/c", "/mnt/host", "/var/run/docker.sock", "/app", "/workspace") if os.path.exists(p)])',
  );
  check('No host filesystem or Docker socket', mounts.includes('host-paths []'), mounts);

  const forks = await probeOutput(
    'import os\ncount = 0\ntry:\n    for _ in range(5000):\n        if os.fork() == 0:\n            import time; time.sleep(3); os._exit(0)\n        count += 1\nexcept Exception as e:\n    print("stopped-after", count, type(e).__name__)\nelse:\n    print("UNLIMITED", count)',
  );
  check('Process count is limited (fork bomb contained)', forks.includes('stopped-after'), forks.slice(0, 80));

  const hidden = await judge(transport, inputFor('Two Sum', 'python', probe('import os\nprint(sorted(os.listdir(".")))')), config);
  const leaked = JSON.stringify(hidden).includes('1000000000');
  check('Hidden test data does not appear in the result', !leaked);

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Verification crashed:', error);
  process.exit(1);
});
