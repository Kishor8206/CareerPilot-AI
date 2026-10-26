import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';

/**
 * Placement-officer scope record. `departments` narrows the analytics a given
 * officer may read; an empty array means institution-wide access.
 */
export interface IPlacementOfficer extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  employeeId?: string;
  designation: string;
  departments: string[];
  institution: string;
  phone?: string;
  canExportData: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const placementOfficerSchema = new Schema<IPlacementOfficer>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    employeeId: { type: String, trim: true },
    designation: { type: String, default: 'Placement Officer', trim: true },
    departments: { type: [String], default: [] },
    institution: { type: String, default: 'University', trim: true },
    phone: { type: String, trim: true },
    canExportData: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

export const PlacementOfficer = registerModel<IPlacementOfficer>('PlacementOfficer', placementOfficerSchema);
