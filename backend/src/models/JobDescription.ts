import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance } from '@careerpilot/shared';

export interface IJobDescription extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  roleId: Types.ObjectId;
  title: string;
  location?: string;
  experienceLevel?: string;
  packageLpa?: number;
  descriptionText: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  /** Keywords an ATS would scan for; derived from the JD at ingestion time. */
  atsKeywords: string[];
  active: boolean;
  provenance: DataProvenance;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobDescriptionSchema = new Schema<IJobDescription>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'JobRole', required: true, index: true },
    title: { type: String, required: true, trim: true },
    location: String,
    experienceLevel: { type: String, default: 'Fresher' },
    packageLpa: Number,
    descriptionText: { type: String, required: true, maxlength: 20000 },
    requiredSkills: { type: [String], default: [], index: true },
    preferredSkills: { type: [String], default: [] },
    responsibilities: { type: [String], default: [] },
    qualifications: { type: [String], default: [] },
    atsKeywords: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.DEMO },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

jobDescriptionSchema.index({ companyId: 1, roleId: 1, active: 1 });
jobDescriptionSchema.index({ title: 'text', descriptionText: 'text' });

export const JobDescription = registerModel<IJobDescription>('JobDescription', jobDescriptionSchema);
