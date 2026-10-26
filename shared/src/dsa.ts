/**
 * DSA practice environment: the vocabulary shared by the judge (backend) and
 * the problem pages (frontend).
 *
 * A problem is defined by a typed function signature. From that one definition
 * the backend generates the starter code and the test harness for every
 * language, so adding a language means adding one code generator, not rewriting
 * every problem.
 */

/** Topic tags offered as filters on the problem list. */
export const DSA_TAGS = [
  'Arrays',
  'Strings',
  'Hashing',
  'Two Pointers',
  'Sliding Window',
  'Linked List',
  'Stack',
  'Queue',
  'Trees',
  'Graphs',
  'Recursion',
  'Backtracking',
  'Dynamic Programming',
  'Greedy',
  'Sorting',
  'Binary Search',
] as const;
export type DsaTag = (typeof DSA_TAGS)[number];

/** Languages the judge can run. `monaco` is the editor's language id. */
export const DSA_LANGUAGES = [
  { id: 'python', label: 'Python', monaco: 'python', extension: 'py' },
  { id: 'cpp', label: 'C++', monaco: 'cpp', extension: 'cpp' },
  { id: 'java', label: 'Java', monaco: 'java', extension: 'java' },
  { id: 'javascript', label: 'JavaScript', monaco: 'javascript', extension: 'js' },
] as const;
export type DsaLanguageId = (typeof DSA_LANGUAGES)[number]['id'];
export const DSA_LANGUAGE_IDS = DSA_LANGUAGES.map((l) => l.id) as DsaLanguageId[];

/** Types allowed for a parameter. */
export const DSA_PARAM_TYPES = [
  'int', 'long', 'double', 'bool', 'string',
  'int[]', 'string[]', 'int[][]',
  'ListNode', 'TreeNode',
] as const;
export type DsaParamType = (typeof DSA_PARAM_TYPES)[number];

/**
 * Types allowed for a return value. The `list<…>` forms differ from the array
 * forms only in Java, where they map to `List<…>` instead of an array.
 */
export const DSA_RETURN_TYPES = [
  ...DSA_PARAM_TYPES,
  'list<int>', 'list<string>', 'list<list<int>>', 'list<list<string>>',
] as const;
export type DsaReturnType = (typeof DSA_RETURN_TYPES)[number];

export interface DsaParam {
  name: string;
  type: DsaParamType;
}

export interface DsaSignature {
  params: DsaParam[];
  returnType: DsaReturnType;
}

/**
 * How the judge compares a returned value with the expected one.
 *   exact           - values must match exactly (floats within a tolerance)
 *   unordered       - top-level list order does not matter
 *   unorderedNested - neither top-level order nor the order inside each inner list matters
 */
export type DsaCompareMode = 'exact' | 'unordered' | 'unorderedNested';

/** A worked example shown in the problem description. */
export interface DsaExample {
  input: string;
  output: string;
  explanation?: string;
}

/** One test: the JSON argument values, in parameter order, and the expected return value. */
export interface DsaTestCase {
  args: unknown[];
  expected: unknown;
  explanation?: string;
}

/** A public test case as shown to the student. Hidden tests never take this shape. */
export interface DsaPublicTestCase {
  /** Parameter name -> JSON-formatted value. */
  inputs: Array<{ name: string; value: string }>;
  expected: string;
  explanation?: string;
}

/** Final verdict of a run or a submission. Decided only by the deterministic judge. */
export const SUBMISSION_STATUSES = [
  'ACCEPTED',
  'WRONG_ANSWER',
  'TIME_LIMIT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'RUNTIME_ERROR',
  'COMPILATION_ERROR',
  'INTERNAL_ERROR',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong Answer',
  TIME_LIMIT_EXCEEDED: 'Time Limit Exceeded',
  MEMORY_LIMIT_EXCEEDED: 'Memory Limit Exceeded',
  RUNTIME_ERROR: 'Runtime Error',
  COMPILATION_ERROR: 'Compilation Error',
  INTERNAL_ERROR: 'Internal Error',
};

/** Label for any stored status, including values written by older builds. */
export function submissionStatusLabel(status: string): string {
  return SUBMISSION_STATUS_LABELS[status as SubmissionStatus] ?? 'Not executed';
}

export const DSA_DEFAULT_TIME_LIMIT_MS = 2000;
export const DSA_DEFAULT_MEMORY_LIMIT_MB = 128;
