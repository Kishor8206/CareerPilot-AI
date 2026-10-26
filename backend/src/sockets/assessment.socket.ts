import type { Server, Socket } from 'socket.io';
import { AttemptStatus, SocketEvent } from '@careerpilot/shared';
import { AssessmentAttempt } from '../models/AssessmentAttempt';
import { moduleLogger } from '../config/logger';
import { attemptRoom } from './emitter';

const log = moduleLogger('socket:assessment');

/**
 * Realtime channel for an in-progress assessment (§13).
 *
 * The socket carries the *server-authoritative* remaining time and autosave
 * acknowledgements. Scoring never happens here - it is REST-only - so a
 * manipulated socket cannot influence a result.
 */
export function registerAssessmentHandlers(io: Server, socket: Socket) {
  const auth = socket.auth!;
  const timers = new Map<string, NodeJS.Timeout>();

  socket.on('assessment:subscribe', async (payload: { attemptId: string }, ack?: (r: unknown) => void) => {
    const attemptId = String(payload?.attemptId ?? '');
    const attempt = await AssessmentAttempt.findById(attemptId).select('userId status expiresAt').lean();

    if (!attempt || String(attempt.userId) !== auth.userId) {
      ack?.({ ok: false, error: 'This assessment attempt is not available to you.' });
      return;
    }
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      ack?.({ ok: false, error: 'This attempt is no longer in progress.' });
      return;
    }

    await socket.join(attemptRoom(attemptId));

    // Push the authoritative remaining time every 5s; the client clock is only
    // a smooth display between ticks.
    const tick = () => {
      const remainingMs = new Date(attempt.expiresAt).getTime() - Date.now();
      socket.emit(SocketEvent.ASSESSMENT_TICK, {
        attemptId,
        remainingSeconds: Math.max(0, Math.floor(remainingMs / 1000)),
        serverTime: Date.now(),
      });
      if (remainingMs <= 0) {
        clearInterval(timers.get(attemptId)!);
        timers.delete(attemptId);
      }
    };
    tick();
    const interval = setInterval(tick, 5000);
    timers.set(attemptId, interval);

    ack?.({ ok: true, expiresAt: attempt.expiresAt, serverTime: Date.now() });
  });

  socket.on('assessment:unsubscribe', async (payload: { attemptId: string }) => {
    const attemptId = String(payload?.attemptId ?? '');
    const timer = timers.get(attemptId);
    if (timer) {
      clearInterval(timer);
      timers.delete(attemptId);
    }
    await socket.leave(attemptRoom(attemptId));
  });

  socket.on('disconnect', () => {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
    log.debug({ userId: auth.userId }, 'Cleared assessment timers on disconnect');
  });
}
