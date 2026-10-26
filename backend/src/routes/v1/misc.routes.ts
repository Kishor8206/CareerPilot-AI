import { Router } from 'express';
import { z } from 'zod';
import * as notificationController from '../../controllers/notification.controller';
import * as privacyController from '../../controllers/privacy.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { notificationQuery } from '../../validators';
import { idParam } from '../../validators/common.validator';

export const notificationRouter = Router();
export const privacyRouter = Router();

/* ---- Notifications (§25) ---- */
notificationRouter.use(authenticate);
notificationRouter.get('/', validate({ query: notificationQuery }), notificationController.list);
notificationRouter.get('/unread-count', notificationController.unreadCount);
notificationRouter.post('/:id/read', validate({ params: idParam }), notificationController.markRead);
notificationRouter.post('/read-all', notificationController.markAllRead);

/* ---- Privacy (§30) ---- */
// The policy itself is public: a prospective user should be able to read what
// the platform would collect before creating an account.
privacyRouter.get('/policy', privacyController.privacyPolicy);

privacyRouter.use(authenticate);
privacyRouter.get('/my-data', privacyController.myData);
privacyRouter.get('/export', privacyController.exportMyData);
privacyRouter.post('/delete-account', privacyController.requestAccountDeletion);
privacyRouter.post(
  '/withdraw-consent',
  validate({ body: z.object({ key: z.enum(['ai_processing', 'recording', 'analytics', 'data_sharing']) }) }),
  privacyController.withdrawConsent,
);
