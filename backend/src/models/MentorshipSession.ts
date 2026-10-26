import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance, SessionStatus } from '@careerpilot/shared';

export interface IMentorshipSession extends Document {
  _id: Types.ObjectId;
  requestId?: Types.ObjectId | null;
  studentId: Types.ObjectId;
  studentUserId: Types.ObjectId;
  alumniId: Types.ObjectId;
  alumniUserId: Types.ObjectId;
  scheduledAt: Date;
  durationMinutes: number;
  status: SessionStatus;
  /** Opaque, unguessable room id used for WebRTC signalling (§19). */
  roomId: string;
  type: 'MOCK_INTERVIEW' | 'MENTORSHIP_CALL' | 'RESUME_REVIEW';
  agenda?: string;
  notes?: string;
  /** Live participant presence, maintained by the Socket.IO room handler. */
  participants: Array<{ userId: Types.ObjectId; role: string; joinedAt: Date; leftAt?: Date | null }>;
  chatLog: Array<{ userId: Types.ObjectId; name: string; message: string; sentAt: Date }>;
  joinedAt?: Date | null;
  endedAt?: Date | null;
  feedbackId?: Types.ObjectId | null;
  recordingConsent: boolean;
  recordingKey?: string | null;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const mentorshipSessionSchema = new Schema<IMentorshipSession>(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'MentorshipRequest', default: null, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    studentUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    alumniId: { type: Schema.Types.ObjectId, ref: 'AlumniProfile', required: true, index: true },
    alumniUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 45, min: 10, max: 240 },
    status: { type: String, enum: Object.values(SessionStatus), default: SessionStatus.SCHEDULED, index: true },
    roomId: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['MOCK_INTERVIEW', 'MENTORSHIP_CALL', 'RESUME_REVIEW'], default: 'MOCK_INTERVIEW' },
    agenda: { type: String, maxlength: 2000 },
    notes: { type: String, maxlength: 8000 },
    participants: {
      type: [
        new Schema(
          {
            userId: { type: Schema.Types.ObjectId, ref: 'User' },
            role: String,
            joinedAt: { type: Date, default: Date.now },
            leftAt: { type: Date, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    chatLog: {
      type: [
        new Schema(
          {
            userId: { type: Schema.Types.ObjectId, ref: 'User' },
            name: String,
            message: { type: String, maxlength: 2000 },
            sentAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    joinedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    feedbackId: { type: Schema.Types.ObjectId, ref: 'AlumniFeedback', default: null },
    recordingConsent: { type: Boolean, default: false },
    recordingKey: { type: String, default: null },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.REAL },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

mentorshipSessionSchema.index({ studentId: 1, scheduledAt: -1 });
mentorshipSessionSchema.index({ alumniId: 1, scheduledAt: -1 });
mentorshipSessionSchema.index({ status: 1, scheduledAt: 1 });

export const MentorshipSession = registerModel<IMentorshipSession>('MentorshipSession', mentorshipSessionSchema);
