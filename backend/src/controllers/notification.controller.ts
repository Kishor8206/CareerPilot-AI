import type { Request, Response } from 'express';
import * as notificationService from '../services/notification.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { buildPaginationMeta, ok, paginated } from '../utils/response';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as { page: number; limit: number; unreadOnly: boolean };
  const { items, total, unreadCount } = await notificationService.listNotifications(req.auth!.userId, query);
  paginated(res, items, buildPaginationMeta(query.page, query.limit, total), { unreadCount });
});

export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  const { unreadCount: count } = await notificationService.listNotifications(req.auth!.userId, { page: 1, limit: 1 });
  ok(res, { unreadCount: count });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const notification = await notificationService.markRead(req.auth!.userId, req.params.id);
  if (!notification) throw ApiError.notFound('Notification');
  ok(res, notification.toJSON());
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const updated = await notificationService.markAllRead(req.auth!.userId);
  ok(res, { updated });
});
