import type { Types } from 'mongoose';
import { NotificationType, SocketEvent } from '@careerpilot/shared';
import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { moduleLogger } from '../config/logger';
import { emitToUser } from '../sockets/emitter';
import { sendEmail } from './email.service';

const log = moduleLogger('notifications');

export interface CreateNotificationInput {
  userId: string | Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  metadata?: Record<string, unknown>;
  /** Also deliver by email through the mail abstraction. */
  sendEmailToo?: boolean;
}

/**
 * Creates an in-app notification, pushes it over Socket.IO if the recipient is
 * connected, and optionally queues an email (§25).
 *
 * Notification failures are logged but never propagated: a student's assessment
 * submission must not fail because a notification could not be written.
 */
export async function notify(input: CreateNotificationInput) {
  try {
    const doc = await Notification.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      metadata: input.metadata ?? {},
      emailQueued: Boolean(input.sendEmailToo),
    });

    emitToUser(String(input.userId), SocketEvent.NOTIFICATION, {
      id: doc._id.toString(),
      type: doc.type,
      title: doc.title,
      body: doc.body,
      link: doc.link,
      read: false,
      createdAt: doc.createdAt.toISOString(),
      metadata: doc.metadata,
    });

    if (input.sendEmailToo) {
      const user = await User.findById(input.userId).select('email fullName');
      if (user) {
        const result = await sendEmail({
          to: user.email,
          subject: input.title,
          text: `Hello ${user.fullName},\n\n${input.body}\n\n- CareerPilot AI`,
        });
        if (result.delivered) {
          await Notification.updateOne({ _id: doc._id }, { $set: { emailSentAt: new Date() } });
        }
      }
    }

    return doc;
  } catch (error) {
    log.error({ err: error, type: input.type, userId: String(input.userId) }, 'Failed to create notification');
    return null;
  }
}

/** Fan-out helper for announcements. */
export async function notifyMany(userIds: Array<string | Types.ObjectId>, input: Omit<CreateNotificationInput, 'userId'>) {
  const results = await Promise.allSettled(userIds.map((userId) => notify({ ...input, userId })));
  return results.filter((r) => r.status === 'fulfilled' && r.value).length;
}

export async function listNotifications(userId: string, options: { page: number; limit: number; unreadOnly?: boolean }) {
  const filter: Record<string, unknown> = { userId };
  if (options.unreadOnly) filter.read = false;

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, read: false }),
  ]);

  return { items, total, unreadCount };
}

export async function markRead(userId: string, notificationId: string) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { $set: { read: true, readAt: new Date() } },
    { new: true },
  );
}

export async function markAllRead(userId: string) {
  const result = await Notification.updateMany(
    { userId, read: false },
    { $set: { read: true, readAt: new Date() } },
  );
  return result.modifiedCount;
}
