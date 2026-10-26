import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance } from '@careerpilot/shared';
import type { AtsBreakdownItem, ParsedResume } from '@careerpilot/shared';

export interface IResumeAnalysis extends Document {
  _id: Types.ObjectId;
  resumeId: Types.ObjectId;
  studentId: Types.ObjectId;
  atsScore: number;
  parsed: ParsedResume;
  breakdown: AtsBreakdownItem[];
  matchedKeywords: string[];
  missingKeywords: string[];
  strengths: string[];
  weaknesses: string[];
  formattingRecommendations: string[];
  jobSpecificRecommendations: string[];
  targetJobDescriptionId?: Types.ObjectId | null;
  /** CATALOGUE = a predefined job; CUSTOM = text the student supplied; null = no comparison. */
  jobDescriptionSource?: 'CATALOGUE' | 'CUSTOM' | null;
  jobDescriptionLabel?: string | null;
  jobMatchScore?: number | null;
  /** Version of the analysis pipeline, so historical scores stay interpretable. */
  engineVersion: string;
  processingMs: number;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const breakdownSchema = new Schema<AtsBreakdownItem>(
  {
    criterion: { type: String, required: true },
    score: { type: Number, required: true },
    maxScore: { type: Number, required: true },
    weight: { type: Number, required: true },
    detail: { type: String, default: '' },
  },
  { _id: false },
);

const resumeAnalysisSchema = new Schema<IResumeAnalysis>(
  {
    resumeId: { type: Schema.Types.ObjectId, ref: 'Resume', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    atsScore: { type: Number, min: 0, max: 100, required: true },
    // The parsed structure comes from the Python NLP service and evolves with it,
    // so it is stored as a free-form subdocument validated at the API boundary.
    parsed: { type: Schema.Types.Mixed, required: true },
    breakdown: { type: [breakdownSchema], default: [] },
    matchedKeywords: { type: [String], default: [] },
    missingKeywords: { type: [String], default: [] },
    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    formattingRecommendations: { type: [String], default: [] },
    jobSpecificRecommendations: { type: [String], default: [] },
    targetJobDescriptionId: { type: Schema.Types.ObjectId, ref: 'JobDescription', default: null },
    jobDescriptionSource: { type: String, enum: ['CATALOGUE', 'CUSTOM', null], default: null },
    jobDescriptionLabel: { type: String, maxlength: 200, default: null },
    jobMatchScore: { type: Number, min: 0, max: 100, default: null },
    engineVersion: { type: String, default: '1.0.0' },
    processingMs: { type: Number, default: 0 },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.REAL },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

resumeAnalysisSchema.index({ studentId: 1, createdAt: -1 });

export const ResumeAnalysis = registerModel<IResumeAnalysis>('ResumeAnalysis', resumeAnalysisSchema);
