import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance, VerificationStatus } from '@careerpilot/shared';
import type { AvailabilitySlot } from '@careerpilot/shared';

export interface IAlumniProfile extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  company: string;
  companyId?: Types.ObjectId | null;
  designation: string;
  experienceYears: number;
  domain: string;
  expertise: string[];
  skills: string[];
  college?: string;
  graduationYear?: number;
  department?: string;
  linkedinUrl?: string;
  bio?: string;
  /** Employment evidence supplied by the alumnus for admin review (§18). */
  employmentProof: {
    workEmail?: string | null;
    employeeId?: string | null;
    documentKey?: string | null;
    submittedAt?: Date | null;
  };
  verificationStatus: VerificationStatus;
  verifiedBy?: Types.ObjectId | null;
  verifiedAt?: Date | null;
  verificationNote?: string | null;
  availability: AvailabilitySlot[];
  acceptingMentees: boolean;
  maxMenteesPerMonth: number;
  sessionsConducted: number;
  ratingSum: number;
  ratingCount: number;
  averageRating: number;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const availabilitySchema = new Schema<AvailabilitySlot>(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    timezone: { type: String, default: 'Asia/Kolkata' },
  },
  { _id: false },
);

const alumniProfileSchema = new Schema<IAlumniProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    company: { type: String, required: true, trim: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
    designation: { type: String, required: true, trim: true },
    experienceYears: { type: Number, min: 0, max: 60, default: 0 },
    domain: { type: String, required: true, trim: true, index: true },
    expertise: { type: [String], default: [], index: true },
    skills: { type: [String], default: [] },
    college: { type: String, trim: true },
    graduationYear: { type: Number, min: 1950, max: 2100 },
    department: { type: String, trim: true, index: true },
    linkedinUrl: String,
    bio: { type: String, maxlength: 2000 },
    employmentProof: {
      workEmail: { type: String, default: null },
      employeeId: { type: String, default: null },
      documentKey: { type: String, default: null },
      submittedAt: { type: Date, default: null },
    },
    verificationStatus: {
      type: String,
      enum: Object.values(VerificationStatus),
      default: VerificationStatus.UNVERIFIED,
      index: true,
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    verificationNote: { type: String, default: null },
    availability: { type: [availabilitySchema], default: [] },
    acceptingMentees: { type: Boolean, default: true },
    maxMenteesPerMonth: { type: Number, min: 0, max: 100, default: 5 },
    sessionsConducted: { type: Number, default: 0 },
    ratingSum: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.REAL },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

// Supports the student-facing mentor search: verified alumni, filtered by
// company/domain, ordered by rating.
alumniProfileSchema.index({ verificationStatus: 1, acceptingMentees: 1, averageRating: -1 });
alumniProfileSchema.index({ company: 'text', designation: 'text', expertise: 'text', domain: 'text' });

export const AlumniProfile = registerModel<IAlumniProfile>('AlumniProfile', alumniProfileSchema);
