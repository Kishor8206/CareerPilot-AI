import { describe, expect, it } from 'vitest';
import { DSA_LANGUAGE_IDS, DSA_TAGS, type DsaLanguageId, type SubmissionStatus } from '@careerpilot/shared';
import { DSA_PROBLEMS, DSA_REFERENCE_SOLUTIONS, type DsaProblemSeed } from '@careerpilot/database';
import { buildProblemDocument } from '../src/services/coding.service';
import { buildProgram, encodeArgs, generateStarterCode, remapLineNumbers } from '../src/services/execution/codegen';
import { buildDockerArgs, DockerTransport } from '../src/services/execution/dockerRunner';
import { classifyRun, judge, outputsMatch, type JudgeInput } from '../src/services/execution/judge.service';
import { buildRunnerScript, type RawTestRun } from '../src/services/execution/sandbox';
import { LOCAL_TOOLCHAINS, LocalProcessTransport } from './support/localTransport';

/**
 * The DSA judge.
 *
 * The first half is pure logic and runs everywhere. The second half judges the
 * repository's own reference solutions with the compilers installed on this
 * machine, through a test-only local transport (see support/localTransport.ts).
 * That proves the harness, runner script and comparator for each language; it
 * does not exercise Docker isolation, which `npm run judge:verify` covers.
 */

const CONFIG = { cpus: 1, maxProcesses: 128 };
const problem = (title: string): DsaProblemSeed => DSA_PROBLEMS.find((p) => p.title === title)!;

function inputFor(seed: DsaProblemSeed, language: DsaLanguageId, code: string, withHidden = true): JudgeInput {
  const doc = buildProblemDocument(seed);
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
    hiddenTests: withHidden ? doc.hiddenTestCases : [],
  };
}

const run = (over: Partial<RawTestRun>): RawTestRun => ({
  exitCode: 0, timeMs: 10, memoryKb: 1000, result: null, stdout: '', stderr: '', ...over,
});

describe('output comparator', () => {
  it('compares parsed values, so formatting can never change a verdict', () => {
    expect(outputsMatch([1, 2, 3], JSON.parse('[1,   2,3]\n'), 'int[]')).toBe(true);
    expect(outputsMatch(5, JSON.parse('5.0'), 'double')).toBe(true);
    expect(outputsMatch('ab', 'ab ', 'string')).toBe(false);
    expect(outputsMatch(true, 1, 'bool')).toBe(false);
    expect(outputsMatch([1, 2], [1, 2, 3], 'int[]')).toBe(false);
    expect(outputsMatch([], null, 'int[]')).toBe(false);
  });

  it('applies a tolerance to floating-point answers only', () => {
    expect(outputsMatch(12.75, 12.7500000001, 'double')).toBe(true);
    expect(outputsMatch(12.75, 12.76, 'double')).toBe(false);
    expect(outputsMatch(3, 3.0000001, 'int')).toBe(false);
  });

  it('honours order-insensitive comparison only when the problem asks for it', () => {
    expect(outputsMatch([0, 1], [1, 0], 'int[]', 'exact')).toBe(false);
    expect(outputsMatch([0, 1], [1, 0], 'int[]', 'unordered')).toBe(true);
    expect(outputsMatch([[1, 2], [3]], [[3], [2, 1]], 'list<list<int>>', 'unordered')).toBe(false);
    expect(outputsMatch([[1, 2], [3]], [[3], [2, 1]], 'list<list<int>>', 'unorderedNested')).toBe(true);
    expect(outputsMatch([[1, 2], [3]], [[3], [2, 2]], 'list<list<int>>', 'unorderedNested')).toBe(false);
  });
});

describe('verdict classification', () => {
  const test = { args: [], expected: 7 };
  const verdict = (over: Partial<RawTestRun>): SubmissionStatus => classifyRun(run(over), test, 'int', 'exact', 2000).status;

  it('maps what the sandbox reports to the seven verdicts', () => {
    expect(verdict({ result: '7' })).toBe('ACCEPTED');
    expect(verdict({ result: '8' })).toBe('WRONG_ANSWER');
    expect(verdict({ exitCode: 124, timeMs: 2000 })).toBe('TIME_LIMIT_EXCEEDED');
    expect(verdict({ exitCode: 137, timeMs: 2400 })).toBe('TIME_LIMIT_EXCEEDED');
    expect(verdict({ hostTimedOut: true, exitCode: 124 })).toBe('TIME_LIMIT_EXCEEDED');
    expect(verdict({ exitCode: 137, timeMs: 300 })).toBe('MEMORY_LIMIT_EXCEEDED');
    expect(verdict({ oomKilled: true, exitCode: 137 })).toBe('MEMORY_LIMIT_EXCEEDED');
    expect(verdict({ exitCode: 1, stderr: 'java.lang.OutOfMemoryError: Java heap space' })).toBe('MEMORY_LIMIT_EXCEEDED');
    expect(verdict({ exitCode: 134, stderr: "terminate called after throwing an instance of 'std::bad_alloc'" })).toBe('MEMORY_LIMIT_EXCEEDED');
    expect(verdict({ exitCode: 1, stderr: 'ZeroDivisionError: division by zero' })).toBe('RUNTIME_ERROR');
    expect(verdict({ exitCode: 139 })).toBe('RUNTIME_ERROR');
  });

  it('never accepts a run that produced no return value', () => {
    expect(verdict({ exitCode: 0, result: null })).toBe('RUNTIME_ERROR');
    expect(verdict({ exitCode: 0, result: 'not json' })).toBe('RUNTIME_ERROR');
    // A correct-looking answer does not rescue a crashed program.
    expect(verdict({ exitCode: 1, result: '7' })).toBe('RUNTIME_ERROR');
  });
});

describe('problem bank', () => {
  it('covers every topic tag and every difficulty', () => {
    const tags = new Set(DSA_PROBLEMS.flatMap((p) => p.tags));
    for (const tag of DSA_TAGS) expect(tags.has(tag), `no problem tagged ${tag}`).toBe(true);
    for (const p of DSA_PROBLEMS) for (const tag of p.tags) expect(DSA_TAGS).toContain(tag);
    expect(new Set(DSA_PROBLEMS.map((p) => p.difficulty))).toEqual(new Set(['EASY', 'MEDIUM', 'HARD']));
  });

  it('builds a valid document for every problem, with tests that fit the signature', () => {
    const slugs = new Set<string>();
    for (const seed of DSA_PROBLEMS) {
      const doc = buildProblemDocument(seed);
      expect(slugs.has(doc.slug)).toBe(false);
      slugs.add(doc.slug);
      expect(doc.testCases.length).toBeGreaterThanOrEqual(2);
      expect(doc.hiddenTestCases.length).toBeGreaterThanOrEqual(3);
      expect(doc.examples.length).toBeGreaterThan(0);
      expect(doc.timeLimitMs).toBe(2000);
      expect(doc.memoryLimitMb).toBe(128);
      for (const language of DSA_LANGUAGE_IDS) {
        expect(doc.starterCode[language]).toContain(seed.functionName);
        expect(DSA_REFERENCE_SOLUTIONS[seed.title]?.[language], `${seed.title} / ${language}`).toBeTruthy();
      }
    }
  });
});

describe('code generation', () => {
  const twoSum = buildProblemDocument(problem('Two Sum'));

  it('gives the student only the function to implement, in each language', () => {
    expect(generateStarterCode('twoSum', twoSum.signature, 'python')).toBe(
      'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        pass\n',
    );
    expect(generateStarterCode('twoSum', twoSum.signature, 'cpp')).toContain('vector<int> twoSum(vector<int>& nums, int target) {');
    expect(generateStarterCode('twoSum', twoSum.signature, 'java')).toContain('public int[] twoSum(int[] nums, int target) {');
    expect(generateStarterCode('twoSum', twoSum.signature, 'javascript')).toContain('var twoSum = function(nums, target) {');
    for (const language of DSA_LANGUAGE_IDS) {
      expect(generateStarterCode('twoSum', twoSum.signature, language)).not.toMatch(/stdin|main\(|readFileSync|Scanner/);
    }
  });

  it('encodes arguments and rejects ones that do not fit the signature', () => {
    expect(encodeArgs(twoSum.signature, [[2, 7], 9])).toBe('2 2 7\n9\n');
    expect(encodeArgs({ params: [{ name: 's', type: 'string' }], returnType: 'bool' }, ['a b'])).toBe('612062\n');
    expect(encodeArgs({ params: [{ name: 's', type: 'string' }], returnType: 'bool' }, [''])).toBe('-\n');
    expect(encodeArgs({ params: [{ name: 'r', type: 'TreeNode' }], returnType: 'int' }, [[1, null, 2]])).toBe('3 1 N 2\n');
    expect(() => encodeArgs(twoSum.signature, [[2, 7]])).toThrow();
    expect(() => encodeArgs(twoSum.signature, [[2, 'x'], 9])).toThrow();
    expect(() => encodeArgs(twoSum.signature, [[2, 7], 1.5])).toThrow();
  });

  it('reports errors against the student\'s line numbers, not the generated file\'s', () => {
    const program = buildProgram('twoSum', twoSum.signature, 'python', 'class Solution:\n    def twoSum(self, nums, target):\n        return 1 / 0\n');
    const generatedLine = program.userLineOffset + 3;
    expect(program.source.split('\n')[generatedLine - 1]).toContain('return 1 / 0');
    expect(remapLineNumbers(`File "main.py", line ${generatedLine}, in twoSum`, 'python', program)).toBe('File "main.py", line 3, in twoSum');
  });

  it('refuses identifiers that could break out of the generated program', () => {
    expect(() => generateStarterCode('x(){};evil', twoSum.signature, 'javascript')).toThrow();
    expect(() => buildRunnerScript({ compileCommand: "echo 'x'", runCommand: 'true', compileTimeoutMs: 1, testTimeoutMs: 1 }, 'n', 'r')).toThrow();
  });
});

describe('docker isolation settings', () => {
  const args = buildDockerArgs('cp-judge-test', { memoryMb: 128, cpus: 1, maxProcesses: 64 }, 'careerpilot-judge:1');
  const value = (flag: string) => args[args.indexOf(flag) + 1];

  it('isolates every container', () => {
    expect(value('--network')).toBe('none');
    expect(args).toContain('--read-only');
    expect(value('--user')).toBe('65534:65534');
    expect(value('--cap-drop')).toBe('ALL');
    expect(value('--security-opt')).toBe('no-new-privileges');
    expect(value('--memory')).toBe('128m');
    expect(value('--memory-swap')).toBe('128m');
    expect(value('--cpus')).toBe('1');
    expect(value('--pids-limit')).toBe('64');
    expect(value('--pull')).toBe('never');
    expect(args).toContain('--rm');
  });

  it('exposes nothing from the host', () => {
    for (const forbidden of ['-v', '--volume', '--mount', '-e', '--env', '--env-file', '--privileged', '-p', '--publish', '--pid', '--device']) {
      expect(args).not.toContain(forbidden);
    }
    expect(args.join(' ')).not.toMatch(/docker\.sock|host\.docker\.internal|--network host/);
  });

  it('reports an unavailable sandbox as Internal Error and never invents a verdict', async () => {
    // DOCKER_BIN points at a binary that does not exist under test (vitest.config.ts).
    const seed = problem('Two Sum');
    const result = await judge(new DockerTransport(), inputFor(seed, 'python', DSA_REFERENCE_SOLUTIONS[seed.title].python), CONFIG);
    expect(result.status).toBe('INTERNAL_ERROR');
    expect(result.executed).toBe(false);
    expect(result.passedCount).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.message).toMatch(/not run/);
  });
});

/* ------------------------------------------------------------------ */
/* Real execution of the repository's reference solutions              */
/* ------------------------------------------------------------------ */

const FULL = process.env.DSA_FULL_MATRIX === '1';
/** One problem per argument/return shape; the full bank runs with DSA_FULL_MATRIX=1. */
const SAMPLE = [
  'Two Sum', 'Valid Palindrome', 'Maximum Average Subarray', 'Merge Two Sorted Lists', 'Invert Binary Tree',
  'Binary Tree Level Order Traversal', 'Course Schedule', 'Group Anagrams', 'Fibonacci Number', 'Merge Intervals',
];
const MATRIX = FULL ? DSA_PROBLEMS : DSA_PROBLEMS.filter((p) => SAMPLE.includes(p.title));
const transport = new LocalProcessTransport();

describe.each(DSA_LANGUAGE_IDS)('reference solutions are Accepted: %s', (language) => {
  it.skipIf(!LOCAL_TOOLCHAINS[language])(`judges ${MATRIX.length} problems`, async () => {
    const failures: string[] = [];
    for (const seed of MATRIX) {
      const result = await judge(transport, inputFor(seed, language, DSA_REFERENCE_SOLUTIONS[seed.title][language]), CONFIG);
      if (result.status !== 'ACCEPTED' || result.passedCount !== seed.tests.length + seed.hidden.length) {
        const first = result.results.find((r) => !r.passed);
        failures.push(
          `${seed.title}: ${result.status} ${result.passedCount}/${result.totalCount} ` +
            `${result.compileOutput ?? ''} ${result.message ?? ''} test#${first?.index} got=${first?.actual} want=${first?.expected} ${first?.stderr ?? ''}`,
        );
      }
    }
    expect(failures).toEqual([]);
  }, 900_000);
});

describe.skipIf(!LOCAL_TOOLCHAINS.python)('verdicts from real runs', () => {
  const seed = problem('Two Sum');
  const judgePython = (code: string, withHidden = true) => judge(transport, inputFor(seed, 'python', code, withHidden), CONFIG);

  it('Wrong Answer, with details for public tests only', async () => {
    const result = await judgePython('class Solution:\n    def twoSum(self, nums, target):\n        print("debug", target)\n        return [0, 1]\n');
    expect(result.status).toBe('WRONG_ANSWER');
    expect(result.executed).toBe(true);
    expect(result.passedCount).toBeGreaterThan(0);
    expect(result.passedCount).toBeLessThan(result.totalCount);

    const publicResults = result.results.filter((r) => !r.hidden);
    const hiddenResults = result.results.filter((r) => r.hidden);
    expect(publicResults).toHaveLength(seed.tests.length);
    expect(hiddenResults).toHaveLength(seed.hidden.length);

    // Console output is captured separately from the returned value.
    expect(publicResults[0].stdout).toContain('debug 9');
    expect(publicResults[0].actual).toBe('[0,1]');
    expect(publicResults[1]).toMatchObject({ passed: false, status: 'WRONG_ANSWER', expected: '[1,2]', actual: '[0,1]' });

    // Hidden tests expose a verdict and timing, and nothing else.
    for (const hidden of hiddenResults) {
      expect(Object.keys(hidden).sort()).toEqual(['executionTimeMs', 'hidden', 'index', 'memoryKb', 'passed', 'status']);
    }
    const serialised = JSON.stringify(result);
    for (const test of seed.hidden) expect(serialised).not.toContain(JSON.stringify(test.args[0]));
  });

  it('Runtime Error, pointing at the student\'s own line', async () => {
    const result = await judgePython('class Solution:\n    def twoSum(self, nums, target):\n        return nums[99]\n', false);
    expect(result.status).toBe('RUNTIME_ERROR');
    expect(result.results[0].stderr).toContain('IndexError');
    expect(result.results[0].stderr).toContain('line 3');
  });

  it('Compilation Error, without running any test', async () => {
    const result = await judgePython('class Solution:\n    def twoSum(self, nums, target)\n        return []\n');
    expect(result.status).toBe('COMPILATION_ERROR');
    expect(result.results).toEqual([]);
    expect(result.passedCount).toBe(0);
    expect(result.compileOutput).toMatch(/SyntaxError|expected/);
  });

  it('Time Limit Exceeded, and the remaining tests are not run', async () => {
    const input = inputFor(seed, 'python', 'class Solution:\n    def twoSum(self, nums, target):\n        while True:\n            pass\n');
    input.problem.timeLimitMs = 400;
    const result = await judge(transport, input, CONFIG);
    expect(result.status).toBe('TIME_LIMIT_EXCEEDED');
    expect(result.results).toHaveLength(1);
    expect(result.passedCount).toBe(0);
  }, 60_000);

  it('a program that exits by itself without returning is not Accepted', async () => {
    const result = await judgePython('import sys\nclass Solution:\n    def twoSum(self, nums, target):\n        sys.stdout.write("[0, 1]")\n        os._exit(0)\n', false);
    expect(result.status).toBe('RUNTIME_ERROR');
    expect(result.passedCount).toBe(0);
  });
});

describe.skipIf(!LOCAL_TOOLCHAINS.cpp || !LOCAL_TOOLCHAINS.java || !LOCAL_TOOLCHAINS.javascript)('compiled languages', () => {
  const seed = problem('Two Sum');

  it('C++ compilation errors are reported with the compiler output', async () => {
    const result = await judge(transport, inputFor(seed, 'cpp', 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        return undefinedThing;\n    }\n};\n'), CONFIG);
    expect(result.status).toBe('COMPILATION_ERROR');
    expect(result.compileOutput).toContain('undefinedThing');
    expect(result.compileOutput).toContain('main.cpp:4');
  }, 120_000);

  it('Java accepts `public class Solution` and the student\'s own imports', async () => {
    const code = 'import java.util.HashMap;\n\npublic class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        HashMap<Integer, Integer> seen = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            if (seen.containsKey(target - nums[i])) return new int[]{seen.get(target - nums[i]), i};\n            seen.put(nums[i], i);\n        }\n        return new int[0];\n    }\n}\n';
    const result = await judge(transport, inputFor(seed, 'java', code), CONFIG);
    expect(result.status).toBe('ACCEPTED');
  }, 120_000);

  it('Java and JavaScript exceptions are Runtime Errors', async () => {
    const java = await judge(transport, inputFor(seed, 'java', 'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[]{nums[99]};\n    }\n}\n', false), CONFIG);
    expect(java.status).toBe('RUNTIME_ERROR');
    expect(java.results[0].stderr).toContain('ArrayIndexOutOfBoundsException');

    const js = await judge(transport, inputFor(seed, 'javascript', 'var twoSum = function(nums, target) {\n    return nums.missing.length;\n};\n', false), CONFIG);
    expect(js.status).toBe('RUNTIME_ERROR');
    expect(js.results[0].stderr).toContain('TypeError');
  }, 120_000);
});
