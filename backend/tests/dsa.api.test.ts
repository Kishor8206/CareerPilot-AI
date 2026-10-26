import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DSA_LANGUAGE_IDS, UserRole } from '@careerpilot/shared';
import { DSA_PROBLEMS, DSA_REFERENCE_SOLUTIONS } from '@careerpilot/database';
import { CodingProblem } from '../src/models/CodingProblem';
import { CodingSubmission } from '../src/models/CodingSubmission';
import { syncDsaProblems } from '../src/services/coding.service';
import { useSandboxTransportForTests } from '../src/services/codeExecution.service';
import { API, auth, createPrivilegedUser, getApp, registerUser, type TestUser } from './helpers';
import { LOCAL_TOOLCHAINS, LocalProcessTransport } from './support/localTransport';

/**
 * DSA environment through the HTTP API: problem list and filters, the problem
 * DTO, Run, Submit, history, progress, and above all that hidden test cases
 * never reach a response.
 *
 * Runs use the test-only local transport with the repository's own reference
 * solutions (see support/localTransport.ts). The AI service is unreachable in
 * this suite by design, which also proves a verdict never depends on it.
 */
const app = getApp();
const WRONG_PYTHON = 'class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]\n';

describe('DSA environment API', () => {
  let student: TestUser;
  let other: TestUser;
  let admin: TestUser;
  let twoSumId: string;
  const twoSum = DSA_PROBLEMS.find((p) => p.title === 'Two Sum')!;
  const total = twoSum.tests.length + twoSum.hidden.length;

  beforeAll(async () => {
    student = await registerUser(UserRole.STUDENT);
    other = await registerUser(UserRole.STUDENT);
    admin = await createPrivilegedUser(UserRole.ADMIN);

    // A problem in the pre-judge stdin/stdout format, as older databases hold.
    await CodingProblem.collection.insertOne({
      title: 'Legacy Problem', slug: 'legacy-problem', statement: 'Old format.', difficulty: 'EASY', topics: ['arrays'],
      testCases: [{ input: '1', expectedOutput: '1', hidden: true }], active: true, provenance: 'DEMO',
    });

    await syncDsaProblems();
    twoSumId = (await CodingProblem.findOne({ slug: 'two-sum' }))!._id.toString();
  });

  afterAll(() => useSandboxTransportForTests(null));

  describe('problem list', () => {
    it('lists the problem bank and hides problems the judge cannot run', async () => {
      const res = await request(app).get(`${API}/coding/problems`).query({ limit: 100 }).set(auth(student));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(DSA_PROBLEMS.length);
      expect(res.body.meta.total).toBe(DSA_PROBLEMS.length);
      expect(res.body.data.map((p: { title: string }) => p.title)).not.toContain('Legacy Problem');
      expect(res.body.data[0]).toEqual(expect.objectContaining({ status: 'TODO', tags: expect.any(Array) }));
      // Easy problems come first.
      expect(res.body.data[0].difficulty).toBe('EASY');
    });

    it('filters by search, difficulty and topic tags', async () => {
      const search = await request(app).get(`${API}/coding/problems`).query({ search: 'two sum' }).set(auth(student));
      expect(search.body.data.map((p: { title: string }) => p.title)).toEqual(['Two Sum']);

      const hard = await request(app).get(`${API}/coding/problems`).query({ difficulty: 'HARD' }).set(auth(student));
      expect(hard.body.data.length).toBe(DSA_PROBLEMS.filter((p) => p.difficulty === 'HARD').length);
      expect(hard.body.data.every((p: { difficulty: string }) => p.difficulty === 'HARD')).toBe(true);

      const linked = await request(app).get(`${API}/coding/problems`).query({ tags: 'Linked List' }).set(auth(student));
      expect(linked.body.data.map((p: { title: string }) => p.title).sort()).toEqual(['Merge Two Sorted Lists', 'Reverse Linked List']);

      const both = await request(app).get(`${API}/coding/problems`).query({ tags: 'Stack,Strings' }).set(auth(student));
      expect(both.body.data.map((p: { title: string }) => p.title)).toEqual(['Valid Parentheses']);

      const unknown = await request(app).get(`${API}/coding/problems`).query({ tags: 'Not A Tag' }).set(auth(student));
      expect(unknown.status).toBe(400);
    });

    it('is closed to anonymous users and to non-students', async () => {
      expect((await request(app).get(`${API}/coding/problems`)).status).toBe(401);
      expect((await request(app).get(`${API}/coding/problems`).set(auth(admin))).status).toBe(403);
    });
  });

  describe('problem page', () => {
    it('returns the statement, starter code for every language and the public tests', async () => {
      const res = await request(app).get(`${API}/coding/problems/${twoSumId}`).set(auth(student));
      expect(res.status).toBe(200);
      const problem = res.body.data;
      expect(problem).toEqual(expect.objectContaining({ title: 'Two Sum', functionName: 'twoSum', timeLimitMs: 2000, memoryLimitMb: 128 }));
      expect(problem.supportedLanguages).toEqual(DSA_LANGUAGE_IDS);
      for (const language of DSA_LANGUAGE_IDS) expect(problem.starterCode[language]).toContain('twoSum');
      expect(problem.testCases).toHaveLength(twoSum.tests.length);
      expect(problem.testCases[0]).toEqual({
        inputs: [{ name: 'nums', value: '[2,7,11,15]' }, { name: 'target', value: '9' }],
        expected: '[0,1]',
        explanation: expect.any(String),
      });
      expect(problem.examples[0].input).toBe('nums = [2,7,11,15], target = 9');
      expect(problem.hiddenTestCount).toBe(twoSum.hidden.length);
    });

    it('never includes hidden test cases or reference solutions', async () => {
      const res = await request(app).get(`${API}/coding/problems/${twoSumId}`).set(auth(student));
      const body = JSON.stringify(res.body);
      expect(res.body.data).not.toHaveProperty('hiddenTestCases');
      expect(res.body.data).not.toHaveProperty('referenceSolutions');
      for (const test of twoSum.hidden) expect(body).not.toContain(JSON.stringify(test.args[0]));
      expect(body).not.toContain('seen = {}');

      // A default query does not load them at all; only the judge asks for them.
      const loaded = await CodingProblem.findById(twoSumId);
      expect(loaded!.hiddenTestCases).toBeUndefined();
      expect(loaded!.referenceSolutions).toBeUndefined();
    });

    it('does not serve a legacy-format problem', async () => {
      const legacy = await CodingProblem.findOne({ slug: 'legacy-problem' });
      expect(legacy!.active).toBe(false);
      const res = await request(app).get(`${API}/coding/problems/${legacy!._id}`).set(auth(student));
      expect(res.status).toBe(404);
    });
  });

  describe('when the sandbox is unavailable', () => {
    // No transport override here: this is the real Docker provider, with the
    // docker binary absent (vitest.config.ts).
    it('says so instead of guessing, and records no progress', async () => {
      const status = await request(app).get(`${API}/coding/sandbox`).set(auth(student));
      expect(status.body.data).toEqual(expect.objectContaining({ available: false, provider: 'docker' }));
      expect(status.body.data.reason).toMatch(/Docker/);

      const run = await request(app).post(`${API}/coding/problems/${twoSumId}/run`).set(auth(student))
        .send({ language: 'python', code: DSA_REFERENCE_SOLUTIONS['Two Sum'].python });
      expect(run.status).toBe(200);
      expect(run.body.data.execution).toEqual(expect.objectContaining({ status: 'INTERNAL_ERROR', executed: false, passedCount: 0, results: [] }));

      const submit = await request(app).post(`${API}/coding/problems/${twoSumId}/submit`).set(auth(student))
        .send({ language: 'python', code: DSA_REFERENCE_SOLUTIONS['Two Sum'].python });
      expect(submit.status).toBe(200);
      expect(submit.body.data.execution.status).toBe('INTERNAL_ERROR');
      expect(submit.body.data.score).toBe(0);
      expect(submit.body.data.aiReview).toBeNull();
      expect(submit.body.data.readiness).toBeNull();

      const progress = await request(app).get(`${API}/coding/progress`).set(auth(student));
      expect(progress.body.data.solved.total).toBe(0);
      expect(progress.body.data.submissions).toBe(0);
      const performance = await request(app).get(`${API}/coding/performance`).set(auth(student));
      expect(performance.body.data).toEqual({ averageScore: null, problemsAttempted: 0, problemsSolved: 0 });

      await CodingSubmission.deleteMany({});
    });
  });

  describe.skipIf(!LOCAL_TOOLCHAINS.python)('run and submit', () => {
    beforeAll(() => useSandboxTransportForTests(new LocalProcessTransport()));

    it('rejects bad input before anything runs', async () => {
      const url = `${API}/coding/problems/${twoSumId}/run`;
      expect((await request(app).post(url).set(auth(student)).send({ language: 'ruby', code: 'x' })).status).toBe(400);
      expect((await request(app).post(url).set(auth(student)).send({ language: 'python', code: '' })).status).toBe(400);
      expect((await request(app).post(url).set(auth(student)).send({ language: 'python', code: 'x'.repeat(100_001) })).status).toBe(400);
      expect((await request(app).post(url).send({ language: 'python', code: 'x' })).status).toBe(401);
      expect((await request(app).post(url).set(auth(admin)).send({ language: 'python', code: 'x' })).status).toBe(403);
    });

    it('Run judges the public tests only and stores nothing', async () => {
      const res = await request(app).post(`${API}/coding/problems/${twoSumId}/run`).set(auth(student))
        .send({ language: 'python', code: DSA_REFERENCE_SOLUTIONS['Two Sum'].python });
      expect(res.status).toBe(200);
      const { execution } = res.body.data;
      expect(execution).toEqual(expect.objectContaining({ status: 'ACCEPTED', executed: true, passedCount: twoSum.tests.length, totalCount: twoSum.tests.length }));
      expect(execution.results.every((r: { hidden: boolean }) => !r.hidden)).toBe(true);
      expect(res.body.data).not.toHaveProperty('aiReview');
      expect(await CodingSubmission.countDocuments()).toBe(0);
    });

    it('Submit of a wrong solution is Wrong Answer and reveals nothing about hidden tests', async () => {
      const res = await request(app).post(`${API}/coding/problems/${twoSumId}/submit`).set(auth(student))
        .send({ language: 'python', code: WRONG_PYTHON });
      expect(res.status).toBe(200);
      const { execution, score, submission } = res.body.data;
      expect(execution.status).toBe('WRONG_ANSWER');
      expect(execution.totalCount).toBe(total);
      expect(execution.passedCount).toBeLessThan(total);
      expect(score).toBeLessThan(100);
      expect(submission.status).toBe('WRONG_ANSWER');

      const hidden = execution.results.filter((r: { hidden: boolean }) => r.hidden);
      expect(hidden).toHaveLength(twoSum.hidden.length);
      for (const result of hidden) {
        expect(Object.keys(result).sort()).toEqual(['executionTimeMs', 'hidden', 'index', 'memoryKb', 'passed', 'status']);
      }
      const body = JSON.stringify(res.body);
      for (const test of twoSum.hidden) expect(body).not.toContain(JSON.stringify(test.args[0]));

      // The stored record is equally clean.
      const stored = JSON.stringify(await CodingSubmission.findById(submission.id).lean());
      for (const test of twoSum.hidden) expect(stored).not.toContain(JSON.stringify(test.args[0]));
    });

    it('Submit of a correct solution is Accepted by the judge, with the AI service down', async () => {
      const res = await request(app).post(`${API}/coding/problems/${twoSumId}/submit`).set(auth(student))
        .send({ language: 'python', code: DSA_REFERENCE_SOLUTIONS['Two Sum'].python });
      expect(res.status).toBe(200);
      expect(res.body.data.execution).toEqual(expect.objectContaining({ status: 'ACCEPTED', passedCount: total, totalCount: total }));
      expect(res.body.data.score).toBe(100);
      expect(res.body.data.submission).toEqual(expect.objectContaining({ status: 'ACCEPTED', language: 'python', passedCount: total }));
      // The advisory review could not be fetched; the verdict stands regardless.
      expect(res.body.data.aiReview).toBeNull();
    });

    it('keeps a per-student submission history', async () => {
      const mine = await request(app).get(`${API}/coding/submissions`).query({ problemId: twoSumId }).set(auth(student));
      expect(mine.status).toBe(200);
      expect(mine.body.data.map((s: { status: string }) => s.status)).toEqual(['ACCEPTED', 'WRONG_ANSWER']);
      expect(mine.body.data[0]).toEqual(expect.objectContaining({ problemTitle: 'Two Sum', language: 'python', totalCount: total, code: expect.stringContaining('twoSum') }));
      expect(mine.body.data[0]).not.toHaveProperty('execution');

      const theirs = await request(app).get(`${API}/coding/submissions`).set(auth(other));
      expect(theirs.body.data).toEqual([]);
    });

    it('reports solved counts by difficulty and marks the problem solved', async () => {
      const progress = await request(app).get(`${API}/coding/progress`).set(auth(student));
      expect(progress.body.data.solved).toEqual({ easy: 1, medium: 0, hard: 0, total: 1 });
      expect(progress.body.data.available.total).toBe(DSA_PROBLEMS.length);
      expect(progress.body.data).toEqual(expect.objectContaining({ attempted: 1, submissions: 2, acceptanceRate: 50 }));

      const list = await request(app).get(`${API}/coding/problems`).query({ search: 'two sum' }).set(auth(student));
      expect(list.body.data[0].status).toBe('SOLVED');

      const fresh = await request(app).get(`${API}/coding/progress`).set(auth(other));
      expect(fresh.body.data.solved.total).toBe(0);
    });

    it('marks a problem attempted when no submission was accepted', async () => {
      const anagram = (await CodingProblem.findOne({ slug: 'valid-anagram' }))!._id.toString();
      await request(app).post(`${API}/coding/problems/${anagram}/submit`).set(auth(other))
        .send({ language: 'python', code: 'class Solution:\n    def isAnagram(self, s, t):\n        return True\n' });
      const list = await request(app).get(`${API}/coding/problems`).query({ search: 'valid anagram' }).set(auth(other));
      expect(list.body.data[0].status).toBe('ATTEMPTED');
    });

    it('re-running the problem bank sync keeps problem ids and submissions', async () => {
      await syncDsaProblems();
      expect((await CodingProblem.findOne({ slug: 'two-sum' }))!._id.toString()).toBe(twoSumId);
      const mine = await request(app).get(`${API}/coding/submissions`).query({ problemId: twoSumId }).set(auth(student));
      expect(mine.body.data).toHaveLength(2);
    });
  });
});
