import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';

/**
 * Structured human feedback from a live alumni mock interview. This is the
 * human-in-the-loop input that APIE blends with the AI scores (§19, §43).
 */
export interface IAlumniFeedback extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  studentId: Types.ObjectId;
  alumniId: Types.ObjectId;
  alumniUserId: Types.ObjectId;
  technicalKnowledge: number;
  communication: number;
  problemSolving: number;
  confidence: number;
  roleSuitability: number;
  overallScore: number;
  recommendation: 'STRONG_HIRE' | 'HIRE' | 'BORDERLINE' | 'NEEDS_WORK';
  strengths: string[];
  improvements: string[];
  comments: string;
  /** Student's rating of the mentor, feeding the alumnus' average rating. */
  studentRating?: number | null;
  appliedToApie: boolean;
  appliedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ratingField = { type: Number, min: 0, max: 10, required: true };

const alumniFeedbackSchema = new Schema<IAlumniFeedback>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'MentorshipSession', required: true, unique: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    alumniId: { type: Schema.Types.ObjectId, ref: 'AlumniProfile', required: true, index: true },
    alumniUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    technicalKnowledge: ratingField,
    communication: ratingField,
    problemSolving: ratingField,
    confidence: ratingField,
    roleSuitability: ratingField,
    overallScore: { type: Number, min: 0, max: 100, default: 0 },
    recommendation: {
      type: String,
      enum: ['STRONG_HIRE', 'HIRE', 'BORDERLINE', 'NEEDS_WORK'],
      default: 'BORDERLINE',
    },
    strengths: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    comments: { type: String, default: '', maxlength: 5000 },
    studentRating: { type: Number, min: 1, max: 5, default: null },
    appliedToApie: { type: Boolean, default: false, index: true },
    appliedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

alumniFeedbackSchema.index({ studentId: 1, createdAt: -1 });

// The five 0-10 dimensions roll up to a single 0-100 score used by APIE.
alumniFeedbackSchema.pre('save', function preSave(next) {
  const dims = [
    this.technicalKnowledge,
    this.communication,
    this.problemSolving,
    this.confidence,
    this.roleSuitability,
  ];
  this.overallScore = Math.round((dims.reduce((a, b) => a + b, 0) / (dims.length * 10)) * 100);
  next();
});

export const AlumniFeedback = registerModel<IAlumniFeedback>('AlumniFeedback', alumniFeedbackSchema);
