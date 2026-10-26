import type { Types } from 'mongoose';
import {
  AgentName, DataProvenance, Difficulty, DSA_DEFAULT_MEMORY_LIMIT_MB, DSA_DEFAULT_TIME_LIMIT_MS, DSA_LANGUAGE_IDS,
  type CodeExecutionResult, type CodingProblemDto, type CodingProblemSummaryDto, type CodingSubmissionDto,
  type DsaLanguageId, type DsaParamType, type DsaProgressDto, type DsaPublicTestCase, type DsaReturnType,
  type DsaSignature, type DsaTestCase,
} from '@careerpilot/shared';
import { DSA_PROBLEMS, DSA_REFERENCE_SOLUTIONS, type DsaProblemSeed } from '@careerpilot/database';
import { moduleLogger } from '../config/logger';
import { CodingProblem, type ICodingProblem } from '../models/CodingProblem';
import { CodingSubmission } from '../models/CodingSubmission';
import { ApiError } from '../utils/ApiError';
import { round, slugify } from '../utils/helpers';
import { aiClient } from './aiClient.service';
import { codeExecutor } from './codeExecution.service';
import { encodeArgs, generateAllStarterCode } from './execution/codegen';
import { formatValue } from './execution/judge.service';

const log = moduleLogger('coding');

/* ------------------------------------------------------------------ */
/* Shaping problems for students                                       */
/* ------------------------------------------------------------------ */

function toPublicTestCase(signature: DsaSignature, test: DsaTestCase): DsaPublicTestCase {
  return {
    inputs: signature.params.map((param, i) => ({ name: param.name, value: formatValue(test.args[i]) })),
    expected: formatValue(test.expected),
    explanation: test.explanation,
  };
}

/**
 * Shapes a problem for a student.
 *
 * Built field by field on purpose: hidden test cases and reference solutions
 * are not merely filtered out, they are never read. Only the *number* of
 * hidden tests is passed in, so this function cannot leak their content.
 */
export function toStudentProblem(problem: ICodingProblem, hiddenTestCount: number): CodingProblemDto {
  return {
    id: problem._id.toString(),
    title: problem.title,
    slug: problem.slug,
    difficulty: problem.difficulty,
    tags: problem.tags,
    companies: problem.companies,
    description: problem.description,
    examples: problem.examples,
    constraints: problem.constraints,
    functionName: problem.functionName,
    signature: problem.signature,
    starterCode: problem.starterCode ?? {},
    supportedLanguages: problem.supportedLanguages,
    testCases: problem.testCases.map((test) => toPublicTestCase(problem.signature, test)),
    hiddenTestCount,
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    hints: problem.hints ?? [],
    provenance: problem.provenance,
  };
}

/** Only problems in the function-signature format are served. */
const JUDGEABLE = { active: true, functionName: { $exists: true, $ne: '' } };

async function countHiddenTests(problemId: Types.ObjectId): Promise<number> {
  const [row] = await CodingProblem.aggregate<{ count: number }>([
    { $match: { _id: problemId } },
    { $project: { count: { $size: { $ifNull: ['$hiddenTestCases', []] } } } },
  ]);
  return row?.count ?? 0;
}

export async function getProblem(problemId: string): Promise<CodingProblemDto> {
  const problem = await CodingProblem.findOne({ _id: problemId, ...JUDGEABLE });
  if (!problem) throw ApiError.notFound('Coding problem');
  return toStudentProblem(problem, await countHiddenTests(problem._id));
}

/* ------------------------------------------------------------------ */
/* Run and Submit                                                      */
/* ------------------------------------------------------------------ */

export interface RunCodeInput {
  problemId: string;
  studentId: Types.ObjectId;
  userId: string;
  language: string;
  code: string;
  attemptId?: string;
}

async function loadForJudging(problemId: string, language: string, withHidden: boolean): Promise<ICodingProblem> {
  const query = CodingProblem.findOne({ _id: problemId, ...JUDGEABLE });
  // Hidden tests are loaded only on the Submit path, and only for the judge.
  const problem = await (withHidden ? query.select('+hiddenTestCases') : query);
  if (!problem) throw ApiError.notFound('Coding problem');
  if (!problem.supportedLanguages.includes(language as DsaLanguageId)) {
    throw ApiError.badRequest(`This problem does not support "${language}".`);
  }
  return problem;
}

function judgeInput(problem: ICodingProblem, language: string, code: string, hiddenTests: DsaTestCase[]) {
  return {
    problem: {
      functionName: problem.functionName,
      signature: problem.signature,
      compareMode: problem.compareMode,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
    },
    language: language as DsaLanguageId,
    code,
    publicTests: problem.testCases,
    hiddenTests,
  };
}

/** "Run": public test cases only. Nothing is stored, scored or reviewed. */
export async function runCode(input: RunCodeInput): Promise<{ execution: CodeExecutionResult }> {
  const problem = await loadForJudging(input.problemId, input.language, false);
  const execution = await codeExecutor.execute(judgeInput(problem, input.language, input.code, []));
  return { execution };
}

/**
 * "Submit": public + hidden test cases. The verdict and the score come from the
 * judge alone. The AI review is requested afterwards, is advisory, and cannot
 * change either.
 */
export async function submitCode(input: RunCodeInput): Promise<{
  execution: CodeExecutionResult;
  score: number;
  submission: CodingSubmissionDto;
  aiReview: Record<string, unknown> | null;
}> {
  const problem = await loadForJudging(input.problemId, input.language, true);
  const execution = await codeExecutor.execute(
    judgeInput(problem, input.language, input.code, problem.hiddenTestCases ?? []),
  );

  const score = execution.executed
    ? round((execution.passedCount / Math.max(1, execution.totalCount)) * 100, 2)
    : 0;

  // Static analysis is supplementary; a failure there must not lose the submission.
  let aiReview: Record<string, unknown> | null = null;
  if (execution.executed) {
    try {
      const reviewPayload = {
        code: input.code,
        language: input.language,
        problemTitle: problem.title,
        problemStatement: problem.description,
        difficulty: problem.difficulty,
        topics: problem.tags,
        passedCount: execution.passedCount,
        totalCount: execution.totalCount,
        executionStatus: execution.status,
        totalExecutionTimeMs: execution.totalExecutionTimeMs,
        peakMemoryKb: execution.peakMemoryKb,
      };
      const result = await aiClient.post<typeof reviewPayload, Record<string, unknown>>(
        '/ai/coding/review',
        reviewPayload,
        {
          userId: input.userId,
          studentId: input.studentId.toString(),
          agent: AgentName.CODING_ASSESSMENT,
          operation: 'coding.review',
        },
      );
      aiReview = result.data;
    } catch (error) {
      log.warn({ err: (error as Error).message }, 'AI code review unavailable; storing the submission without it');
    }
  }

  const submission = await CodingSubmission.create({
    problemId: problem._id,
    studentId: input.studentId,
    userId: input.userId,
    attemptId: input.attemptId ?? null,
    language: input.language,
    code: input.code,
    isDraftRun: false,
    status: execution.status,
    passedCount: execution.passedCount,
    totalCount: execution.totalCount,
    runtimeMs: execution.runtimeMs,
    memoryKb: execution.peakMemoryKb,
    execution,
    score,
    aiReview,
  });

  log.info(
    { submissionId: submission._id.toString(), status: execution.status, score, provider: execution.provider },
    'Coding submission recorded',
  );

  return { execution, score, aiReview, submission: toSubmissionDto(submission.toObject(), problem.title) };
}

/* ------------------------------------------------------------------ */
/* Problem list, history, progress                                     */
/* ------------------------------------------------------------------ */

export interface ProblemFilters {
  difficulty?: string;
  /** Problems must carry every listed tag. */
  tags?: string[];
  company?: string;
  search?: string;
  page: number;
  limit: number;
}

const DIFFICULTY_ORDER: Record<string, number> = { EASY: 0, MEDIUM: 1, HARD: 2 };

export async function listProblems(
  filters: ProblemFilters,
  studentId?: Types.ObjectId,
): Promise<{ items: CodingProblemSummaryDto[]; total: number }> {
  const query: Record<string, unknown> = { ...JUDGEABLE };
  if (filters.difficulty) query.difficulty = filters.difficulty;
  if (filters.tags?.length) query.tags = { $all: filters.tags };
  if (filters.company) query.companies = filters.company;
  if (filters.search) {
    const safe = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.title = { $regex: safe, $options: 'i' };
  }

  const all = await CodingProblem.find(query).select('title slug difficulty tags companies').lean();
  all.sort(
    (a, b) => (DIFFICULTY_ORDER[a.difficulty] ?? 9) - (DIFFICULTY_ORDER[b.difficulty] ?? 9) || a.title.localeCompare(b.title),
  );
  const page = all.slice((filters.page - 1) * filters.limit, filters.page * filters.limit);

  // Annotate with the student's own results so the list doubles as a progress view.
  const state = new Map<string, 'SOLVED' | 'ATTEMPTED'>();
  if (studentId && page.length) {
    const rows = await CodingSubmission.aggregate<{ _id: Types.ObjectId; accepted: number }>([
      { $match: { studentId, isDraftRun: false, problemId: { $in: page.map((p) => p._id) } } },
      { $group: { _id: '$problemId', accepted: { $max: { $cond: [{ $eq: ['$status', 'ACCEPTED'] }, 1, 0] } } } },
    ]);
    for (const row of rows) state.set(String(row._id), row.accepted ? 'SOLVED' : 'ATTEMPTED');
  }

  return {
    items: page.map((p) => ({
      id: p._id.toString(),
      title: p.title,
      slug: p.slug,
      difficulty: p.difficulty,
      tags: p.tags ?? [],
      companies: p.companies ?? [],
      status: state.get(p._id.toString()) ?? 'TODO',
    })),
    total: all.length,
  };
}

type SubmissionRow = {
  _id: Types.ObjectId;
  problemId: unknown;
  language: string;
  code: string;
  status?: string;
  passedCount?: number;
  totalCount?: number;
  runtimeMs?: number;
  memoryKb?: number;
  score: number;
  execution?: Partial<CodeExecutionResult>;
  createdAt: Date;
};

function toSubmissionDto(row: SubmissionRow, problemTitle?: string): CodingSubmissionDto {
  const populated = row.problemId as { _id?: Types.ObjectId; title?: string } | Types.ObjectId;
  const problemId = (populated as { _id?: Types.ObjectId })?._id ?? populated;
  return {
    id: row._id.toString(),
    problemId: String(problemId),
    problemTitle: problemTitle ?? (populated as { title?: string })?.title,
    language: row.language,
    code: row.code,
    // Records written before the judge existed carry their status only inside `execution`.
    status: (row.status ?? row.execution?.status ?? 'ERROR') as CodingSubmissionDto['status'],
    passedCount: row.passedCount ?? row.execution?.passedCount ?? 0,
    totalCount: row.totalCount ?? row.execution?.totalCount ?? 0,
    runtimeMs: row.runtimeMs ?? 0,
    memoryKb: row.memoryKb ?? row.execution?.peakMemoryKb ?? 0,
    score: row.score,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** A student's own submissions, newest first. Scoped to the caller by `studentId`. */
export async function listSubmissions(studentId: Types.ObjectId, problemId?: string): Promise<CodingSubmissionDto[]> {
  const query: Record<string, unknown> = { studentId, isDraftRun: false };
  if (problemId) query.problemId = problemId;

  const rows = await CodingSubmission.find(query)
    .select('problemId language code status passedCount totalCount runtimeMs memoryKb score execution.status execution.passedCount execution.totalCount execution.peakMemoryKb createdAt')
    .populate<{ problemId: { _id: Types.ObjectId; title: string } }>('problemId', 'title')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return rows.map((row) => toSubmissionDto(row as unknown as SubmissionRow));
}

/** Verdicts that mean the code actually ran. */
const EXECUTED_STATUSES = [
  'ACCEPTED', 'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'RUNTIME_ERROR', 'COMPILATION_ERROR',
];

/** Solved counts by difficulty, for the dashboard and the problem list. */
export async function dsaProgress(studentId: Types.ObjectId): Promise<DsaProgressDto> {
  const [available, solvedRows, totals] = await Promise.all([
    CodingProblem.aggregate<{ _id: string; count: number }>([
      { $match: JUDGEABLE },
      { $group: { _id: '$difficulty', count: { $sum: 1 } } },
    ]),
    CodingSubmission.aggregate<{ _id: string; count: number }>([
      { $match: { studentId, isDraftRun: false, status: 'ACCEPTED' } },
      { $group: { _id: '$problemId' } },
      { $lookup: { from: CodingProblem.collection.name, localField: '_id', foreignField: '_id', as: 'problem' } },
      { $unwind: '$problem' },
      { $match: { 'problem.active': true } },
      { $group: { _id: '$problem.difficulty', count: { $sum: 1 } } },
    ]),
    CodingSubmission.aggregate<{ submissions: number; accepted: number; problems: Types.ObjectId[] }>([
      { $match: { studentId, isDraftRun: false, status: { $in: EXECUTED_STATUSES } } },
      {
        $group: {
          _id: null,
          submissions: { $sum: 1 },
          accepted: { $sum: { $cond: [{ $eq: ['$status', 'ACCEPTED'] }, 1, 0] } },
          problems: { $addToSet: '$problemId' },
        },
      },
    ]),
  ]);

  const tally = (rows: Array<{ _id: string; count: number }>) => {
    const by = (d: Difficulty) => rows.find((r) => r._id === d)?.count ?? 0;
    const easy = by(Difficulty.EASY);
    const medium = by(Difficulty.MEDIUM);
    const hard = by(Difficulty.HARD);
    return { easy, medium, hard, total: easy + medium + hard };
  };

  const total = totals[0];
  return {
    solved: tally(solvedRows),
    available: tally(available),
    attempted: total?.problems.length ?? 0,
    submissions: total?.submissions ?? 0,
    acceptanceRate: total?.submissions ? round((total.accepted / total.submissions) * 100, 1) : null,
  };
}

/** Mean of each problem's best score - the coding signal the readiness engine consumes. */
export async function codingPerformance(studentId: Types.ObjectId) {
  const best = await CodingSubmission.aggregate([
    // Submissions the sandbox could not run are not evidence about the student.
    { $match: { studentId, isDraftRun: false, status: { $in: EXECUTED_STATUSES } } },
    { $group: { _id: '$problemId', bestScore: { $max: '$score' } } },
  ]);

  if (!best.length) {
    return { averageScore: null, problemsAttempted: 0, problemsSolved: 0 };
  }

  const scores = best.map((b) => b.bestScore as number);
  return {
    averageScore: round(scores.reduce((a, b) => a + b, 0) / scores.length, 2),
    problemsAttempted: best.length,
    problemsSolved: scores.filter((s) => s === 100).length,
  };
}

/* ------------------------------------------------------------------ */
/* Problem bank                                                        */
/* ------------------------------------------------------------------ */

function exampleInput(signature: DsaSignature, test: DsaTestCase): string {
  return signature.params.map((param, i) => `${param.name} = ${formatValue(test.args[i])}`).join(', ');
}

/** Turns one seed definition into a stored problem, validating every test against the signature. */
export function buildProblemDocument(seed: DsaProblemSeed) {
  const signature: DsaSignature = {
    params: seed.params.map(([name, type]) => ({ name, type: type as DsaParamType })),
    returnType: seed.returns as DsaReturnType,
  };
  // Throws on a test whose arguments do not fit the signature, so a bad
  // definition is caught when it is loaded, not when a student submits.
  for (const test of [...seed.tests, ...seed.hidden]) encodeArgs(signature, test.args);

  return {
    title: seed.title,
    slug: slugify(seed.title),
    difficulty: seed.difficulty as Difficulty,
    tags: seed.tags,
    companies: seed.companies,
    description: seed.description,
    examples: seed.tests.slice(0, 3).map((test) => ({
      input: exampleInput(signature, test),
      output: formatValue(test.expected),
      explanation: test.explanation,
    })),
    constraints: seed.constraints,
    functionName: seed.functionName,
    signature,
    compareMode: seed.compare ?? 'exact',
    starterCode: generateAllStarterCode(seed.functionName, signature, DSA_LANGUAGE_IDS),
    supportedLanguages: [...DSA_LANGUAGE_IDS],
    testCases: seed.tests,
    hiddenTestCases: seed.hidden,
    referenceSolutions: DSA_REFERENCE_SOLUTIONS[seed.title] ?? {},
    timeLimitMs: seed.timeLimitMs ?? DSA_DEFAULT_TIME_LIMIT_MS,
    memoryLimitMb: seed.memoryLimitMb ?? DSA_DEFAULT_MEMORY_LIMIT_MB,
    hints: seed.hints,
    active: true,
    provenance: DataProvenance.DEMO,
  };
}

/**
 * Loads the bundled problem bank into the database. Safe to run repeatedly:
 * problems are matched by slug and updated in place, so problem ids (and the
 * submissions that reference them) survive.
 *
 * Problems from before the judge used a stdin/stdout format it cannot run;
 * they are deactivated rather than deleted, so existing submissions keep their
 * reference.
 */
export async function syncDsaProblems(): Promise<{ upserted: number; retired: number }> {
  let upserted = 0;
  for (const seed of DSA_PROBLEMS) {
    const doc = buildProblemDocument(seed);
    await CodingProblem.findOneAndUpdate({ slug: doc.slug }, { $set: doc }, { upsert: true, setDefaultsOnInsert: true });
    upserted += 1;
  }

  const retired = await CodingProblem.updateMany(
    { active: true, $or: [{ functionName: { $exists: false } }, { functionName: '' }] },
    { $set: { active: false } },
  );

  log.info({ upserted, retired: retired.modifiedCount }, 'DSA problem bank synchronised');
  return { upserted, retired: retired.modifiedCount };
}
