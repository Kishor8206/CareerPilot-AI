import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { NotificationType } from '@careerpilot/shared';

export interface INotification extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  readAt?: Date | null;
  metadata: Record<string, unknown>;
  /** Delivery bookkeeping for the email abstraction (§25). */
  emailQueued: boolean;
  emailSentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(NotificationType), required: true, index: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 2000 },
    link: { type: String, default: null },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    emailQueued: { type: Boolean, default: false },
    emailSentAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export const Notification = registerModel<INotification>('Notification', notificationSchema);
