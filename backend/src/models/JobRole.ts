import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance } from '@careerpilot/shared';

export interface IJobRole extends Document {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  family: string;
  description?: string;
  coreSkills: string[];
  interviewTopics: string[];
  active: boolean;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const jobRoleSchema = new Schema<IJobRole>(
  {
    title: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    family: { type: String, required: true, trim: true, index: true },
    description: { type: String, maxlength: 4000 },
    /** Skills that define the role irrespective of employer. */
    coreSkills: { type: [String], default: [], index: true },
    /** Topics the interview agent should bias questions toward. */
    interviewTopics: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.DEMO },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

export const JobRole = registerModel<IJobRole>('JobRole', jobRoleSchema);
