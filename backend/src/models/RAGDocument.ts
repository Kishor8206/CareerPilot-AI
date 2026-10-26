import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance } from '@careerpilot/shared';

/**
 * Source of truth for the RAG knowledge base (§10).
 *
 * MongoDB holds the canonical document and its chunks; the vector index lives in
 * the Python service. `indexedAt` tracks whether the two are in sync so an admin
 * can trigger a re-index after editing a document.
 */
export interface IRAGDocument extends Document {
  _id: Types.ObjectId;
  title: string;
  category:
    | 'COMPANY_PROFILE'
    | 'JOB_DESCRIPTION'
    | 'ROLE_REQUIREMENTS'
    | 'INTERVIEW_PREP'
    | 'CODING_PATTERN'
    | 'HR_PREP'
    | 'GD_TOPIC'
    | 'CAREER_RESOURCE';
  companyId?: Types.ObjectId | null;
  roleId?: Types.ObjectId | null;
  content: string;
  /** Where this content came from. Empty means it must not be cited as fact. */
  sourceUrls: string[];
  sourceNote?: string;
  tags: string[];
  chunkCount: number;
  indexedAt?: Date | null;
  indexVersion?: string | null;
  active: boolean;
  provenance: DataProvenance;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ragDocumentSchema = new Schema<IRAGDocument>(
  {
    title: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: [
        'COMPANY_PROFILE',
        'JOB_DESCRIPTION',
        'ROLE_REQUIREMENTS',
        'INTERVIEW_PREP',
        'CODING_PATTERN',
        'HR_PREP',
        'GD_TOPIC',
        'CAREER_RESOURCE',
      ],
      required: true,
      index: true,
    },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'JobRole', default: null, index: true },
    content: { type: String, required: true, maxlength: 100_000 },
    sourceUrls: { type: [String], default: [] },
    sourceNote: String,
    tags: { type: [String], default: [], index: true },
    chunkCount: { type: Number, default: 0 },
    indexedAt: { type: Date, default: null },
    indexVersion: { type: String, default: null },
    active: { type: Boolean, default: true, index: true },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.DEMO },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

ragDocumentSchema.index({ category: 1, active: 1 });
ragDocumentSchema.index({ title: 'text', content: 'text' });

export const RAGDocument = registerModel<IRAGDocument>('RAGDocument', ragDocumentSchema);
