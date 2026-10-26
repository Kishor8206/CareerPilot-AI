import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { MonitoringEventType, RiskLevel } from '@careerpilot/shared';

/**
 * Assessment-integrity signal (§14).
 *
 * These records are advisory. Nothing in the system fails a student because of
 * a monitoring event; they raise a LOW/MEDIUM/HIGH indicator that a human
 * reviews. Deliberately excluded: any inference of identity, demographics,
 * emotion or disability.
 */
export interface IMonitoringEvent extends Document {
  _id: Types.ObjectId;
  attemptId?: Types.ObjectId | null;
  interviewSessionId?: Types.ObjectId | null;
  studentId: Types.ObjectId;
  userId: Types.ObjectId;
  type: MonitoringEventType;
  severity: RiskLevel;
  /** Human-readable reason shown to both the student and the reviewer. */
  explanation: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
  reviewed: boolean;
  reviewedBy?: Types.ObjectId | null;
  reviewNote?: string | null;
  createdAt: Date;
}

const monitoringEventSchema = new Schema<IMonitoringEvent>(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: 'AssessmentAttempt', default: null, index: true },
    interviewSessionId: { type: Schema.Types.ObjectId, ref: 'InterviewSession', default: null, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: Object.values(MonitoringEventType), required: true, index: true },
    severity: { type: String, enum: Object.values(RiskLevel), default: RiskLevel.LOW, index: true },
    explanation: { type: String, required: true },
    occurredAt: { type: Date, default: Date.now, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    reviewed: { type: Boolean, default: false, index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewNote: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { virtuals: true } },
);

monitoringEventSchema.index({ attemptId: 1, occurredAt: 1 });
monitoringEventSchema.index({ severity: 1, reviewed: 1, createdAt: -1 });

export const MonitoringEvent = registerModel<IMonitoringEvent>('MonitoringEvent', monitoringEventSchema);
