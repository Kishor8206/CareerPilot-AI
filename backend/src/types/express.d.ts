import type { UserRole } from '@careerpilot/shared';
import type { Types } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      /** Populated by `authenticate`; absent on public routes. */
      auth?: {
        userId: string;
        role: UserRole;
        email: string;
        sessionId?: string;
      };
      /** Cached StudentProfile id, resolved by `requireStudentProfile`. */
      studentId?: Types.ObjectId;
      /** Cached AlumniProfile id, resolved by `requireAlumniProfile`. */
      alumniId?: Types.ObjectId;
      /** Correlation id echoed in responses and logs. */
      requestId?: string;
    }
  }
}

export {};
