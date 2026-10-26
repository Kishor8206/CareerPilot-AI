import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';

export interface IResume extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  userId: Types.ObjectId;
  originalName: string;
  /** Opaque key resolved by the storage abstraction (local disk or S3). */
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  version: number;
  isPrimary: boolean;
  parseStatus: 'PENDING' | 'PARSED' | 'FAILED';
  parseError?: string | null;
  extractedTextLength: number;
  latestAnalysisId?: Types.ObjectId | null;
  /** Privacy (§30): the file is purged after this date by the retention job. */
  retentionUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const resumeSchema = new Schema<IResume>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    originalName: { type: String, required: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    checksum: { type: String, required: true, index: true },
    version: { type: Number, default: 1 },
    isPrimary: { type: Boolean, default: true, index: true },
    parseStatus: { type: String, enum: ['PENDING', 'PARSED', 'FAILED'], default: 'PENDING', index: true },
    parseError: { type: String, default: null },
    extractedTextLength: { type: Number, default: 0 },
    latestAnalysisId: { type: Schema.Types.ObjectId, ref: 'ResumeAnalysis', default: null },
    retentionUntil: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

resumeSchema.index({ studentId: 1, createdAt: -1 });

export const Resume = registerModel<IResume>('Resume', resumeSchema);
