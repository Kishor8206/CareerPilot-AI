import { Router } from 'express';
import * as controller from '../../controllers/speech.controller';
import { authenticate } from '../../middleware/auth';
import { aiLimiter } from '../../middleware/rateLimit';
import { uploadAudio } from '../../middleware/upload';

export const speechRouter = Router();

speechRouter.use(authenticate);

/**
 * Speech-to-text fallback (§11).
 *
 * Available to any signed-in user: voice input is used in interviews and group
 * discussions, and the client checks `/status` before recording so it never
 * captures audio it cannot transcribe.
 */
speechRouter.get('/status', controller.status);

// Rate-limited per user: transcription is a compute-heavy AI operation.
speechRouter.post('/transcribe', aiLimiter, uploadAudio, controller.transcribe);
