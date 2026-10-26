import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import {
  DataProvenance, Difficulty, DSA_DEFAULT_MEMORY_LIMIT_MB, DSA_DEFAULT_TIME_LIMIT_MS, DSA_LANGUAGE_IDS,
} from '@careerpilot/shared';
import type { DsaCompareMode, DsaExample, DsaLanguageId, DsaSignature, DsaTestCase } from '@careerpilot/shared';

export interface ICodingProblem extends Document {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  difficulty: Difficulty;
  /** Topic tags, drawn from DSA_TAGS. */
  tags: string[];
  companies: string[];
  description: string;
  examples: DsaExample[];
  constraints: string[];
  /** The function the student implements, and its typed signature. */
  functionName: string;
  signature: DsaSignature;
  compareMode: DsaCompareMode;
  /** Per-language starter code, generated from the signature. */
  starterCode: Record<string, string>;
  supportedLanguages: DsaLanguageId[];
  /** Public test cases: shown to students and used by "Run". */
  testCases: DsaTestCase[];
  /**
   * Hidden test cases: used only by "Submit". `select: false` keeps them out of
   * every query that does not ask for them by name, so they cannot reach an API
   * response by accident.
   */
  hiddenTestCases?: DsaTestCase[];
  /** Stored for the judge's self-verification only. Never sent to students. */
  referenceSolutions?: Record<string, string>;
  timeLimitMs: number;
  memoryLimitMb: number;
  hints: string[];
  active: boolean;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const testCaseSchema = new Schema<DsaTestCase>(
  {
    args: { type: [Schema.Types.Mixed], required: true },
    expected: { type: Schema.Types.Mixed, default: null },
    explanation: String,
  },
  { _id: false, minimize: false },
);

const exampleSchema = new Schema<DsaExample>(
  { input: { type: String, required: true }, output: { type: String, required: true }, explanation: String },
  { _id: false },
);

const signatureSchema = new Schema<DsaSignature>(
  {
    params: {
      type: [new Schema({ name: { type: String, required: true }, type: { type: String, required: true } }, { _id: false })],
      default: [],
    },
    returnType: { type: String, required: true },
  },
  { _id: false },
);

const codingProblemSchema = new Schema<ICodingProblem>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    difficulty: { type: String, enum: Object.values(Difficulty), default: Difficulty.EASY, index: true },
    tags: { type: [String], default: [], index: true },
    companies: { type: [String], default: [], index: true },
    description: { type: String, required: true, maxlength: 20000 },
    examples: { type: [exampleSchema], default: [] },
    constraints: { type: [String], default: [] },
    functionName: { type: String, required: true },
    signature: { type: signatureSchema, required: true },
    compareMode: { type: String, enum: ['exact', 'unordered', 'unorderedNested'], default: 'exact' },
    starterCode: { type: Schema.Types.Mixed, default: {} },
    supportedLanguages: { type: [String], enum: DSA_LANGUAGE_IDS, default: () => [...DSA_LANGUAGE_IDS] },
    testCases: { type: [testCaseSchema], default: [] },
    hiddenTestCases: { type: [testCaseSchema], default: [], select: false },
    referenceSolutions: { type: Schema.Types.Mixed, default: {}, select: false },
    timeLimitMs: { type: Number, default: DSA_DEFAULT_TIME_LIMIT_MS, min: 100, max: 20_000 },
    memoryLimitMb: { type: Number, default: DSA_DEFAULT_MEMORY_LIMIT_MB, min: 32, max: 1024 },
    hints: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.DEMO },
  },
  { timestamps: true, minimize: false, toJSON: { virtuals: true } },
);

codingProblemSchema.index({ difficulty: 1, active: 1 });

export const CodingProblem = registerModel<ICodingProblem>('CodingProblem', codingProblemSchema);
