import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance } from '@careerpilot/shared';
import type { RecruitmentPattern } from '@careerpilot/shared';

export interface ICompany extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  industry: string;
  tier?: string;
  website?: string;
  description?: string;
  headquarters?: string;
  logoUrl?: string;
  recruitmentPattern: RecruitmentPattern;
  active: boolean;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const roundSchema = new Schema(
  { name: { type: String, required: true }, description: String, durationMinutes: Number },
  { _id: false },
);

const recruitmentPatternSchema = new Schema<RecruitmentPattern>(
  {
    rounds: { type: [roundSchema], default: [] },
    eligibility: {
      minCgpa: Number,
      maxBacklogs: Number,
      allowedDepartments: { type: [String], default: [] },
    },
    averagePackageLpa: Number,
    hiringSeason: String,
    // Empty `sources` marks the pattern as unverified; the RAG layer refuses to
    // present unsourced recruitment claims as fact (§10).
    sources: { type: [String], default: [] },
  },
  { _id: false },
);

const companySchema = new Schema<ICompany>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    industry: { type: String, required: true, trim: true, index: true },
    tier: { type: String, enum: ['TIER_1', 'TIER_2', 'TIER_3', 'PRODUCT', 'SERVICE', 'STARTUP'], default: 'SERVICE' },
    website: String,
    description: { type: String, maxlength: 4000 },
    headquarters: String,
    logoUrl: String,
    recruitmentPattern: { type: recruitmentPatternSchema, default: () => ({ rounds: [], sources: [] }) },
    active: { type: Boolean, default: true, index: true },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.DEMO, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

companySchema.index({ name: 'text', industry: 'text', description: 'text' });

export const Company = registerModel<ICompany>('Company', companySchema);
