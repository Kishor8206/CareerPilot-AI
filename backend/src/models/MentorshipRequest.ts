import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { MentorshipStatus } from '@careerpilot/shared';

export interface IMentorshipRequest extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  studentUserId: Types.ObjectId;
  alumniId: Types.ObjectId;
  alumniUserId: Types.ObjectId;
  status: MentorshipStatus;
  topic: string;
  message: string;
  targetRole?: string;
  targetCompany?: string;
  /** ISO datetimes the student proposed; the alumnus picks one when accepting. */
  preferredSlots: string[];
  respondedAt?: Date | null;
  responseMessage?: string | null;
  sessionId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const mentorshipRequestSchema = new Schema<IMentorshipRequest>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    studentUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    alumniId: { type: Schema.Types.ObjectId, ref: 'AlumniProfile', required: true, index: true },
    alumniUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: Object.values(MentorshipStatus), default: MentorshipStatus.PENDING, index: true },
    topic: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 2000 },
    targetRole: String,
    targetCompany: String,
    preferredSlots: { type: [String], default: [] },
    respondedAt: { type: Date, default: null },
    responseMessage: { type: String, default: null },
    sessionId: { type: Schema.Types.ObjectId, ref: 'MentorshipSession', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

mentorshipRequestSchema.index({ alumniId: 1, status: 1, createdAt: -1 });
// Stops a student spamming the same mentor with duplicate open requests.
mentorshipRequestSchema.index(
  { studentId: 1, alumniId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: MentorshipStatus.PENDING } },
);

export const MentorshipRequest = registerModel<IMentorshipRequest>('MentorshipRequest', mentorshipRequestSchema);
