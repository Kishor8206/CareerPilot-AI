import type { Server, Socket } from 'socket.io';
import { SessionStatus, SocketEvent, UserRole } from '@careerpilot/shared';
import { MentorshipSession } from '../models/MentorshipSession';
import { moduleLogger } from '../config/logger';
import { interviewRoom } from './emitter';
import type { SocketAuth } from './index';

const log = moduleLogger('socket:interview');

/**
 * Live interview room: presence, chat and WebRTC signalling (§19).
 *
 * The server is a signalling relay only - audio and video travel peer-to-peer
 * over WebRTC and never pass through this process.
 */
export function registerInterviewHandlers(io: Server, socket: Socket) {
  const auth = socket.auth!;

  /**
   * Authorises the caller for a room. Only the two booked participants (plus an
   * admin) may join, and only while the session is scheduled or live.
   */
  async function authorizeRoom(roomId: string) {
    const session = await MentorshipSession.findOne({ roomId })
      .select('studentUserId alumniUserId status scheduledAt durationMinutes type')
      .lean();
    if (!session) return { ok: false as const, reason: 'This interview room does not exist.' };

    const isStudent = String(session.studentUserId) === auth.userId;
    const isAlumni = String(session.alumniUserId) === auth.userId;
    const isAdmin = auth.role === UserRole.ADMIN;
    if (!isStudent && !isAlumni && !isAdmin) {
      return { ok: false as const, reason: 'You are not a participant in this interview.' };
    }
    if (session.status === SessionStatus.CANCELLED || session.status === SessionStatus.COMPLETED) {
      return { ok: false as const, reason: 'This interview session has already ended.' };
    }
    return { ok: true as const, session, role: isStudent ? 'STUDENT' : isAlumni ? 'ALUMNI' : 'OBSERVER' };
  }

  socket.on(SocketEvent.INTERVIEW_JOIN, async (payload: { roomId: string }, ack?: (r: unknown) => void) => {
    try {
      const roomId = String(payload?.roomId ?? '');
      const result = await authorizeRoom(roomId);
      if (!result.ok) {
        ack?.({ ok: false, error: result.reason });
        return;
      }

      const room = interviewRoom(roomId);
      await socket.join(room);

      // Mark the session live on first join and record participant presence.
      await MentorshipSession.updateOne(
        { roomId, status: SessionStatus.SCHEDULED },
        { $set: { status: SessionStatus.LIVE, joinedAt: new Date() } },
      );
      await MentorshipSession.updateOne(
        { roomId },
        { $push: { participants: { userId: auth.userId, role: result.role, joinedAt: new Date() } } },
      );

      const sockets = await io.in(room).fetchSockets();
      const peers = sockets
        .filter((s) => s.id !== socket.id)
        .map((s) => {
          const peerAuth = (s.data as { auth?: SocketAuth }).auth;
          return { socketId: s.id, userId: peerAuth?.userId, email: peerAuth?.email };
        });

      socket.to(room).emit(SocketEvent.INTERVIEW_PARTICIPANT_JOINED, {
        socketId: socket.id,
        userId: auth.userId,
        role: result.role,
        at: new Date().toISOString(),
      });

      ack?.({ ok: true, roomId, role: result.role, peers, sessionType: result.session.type });
      log.debug({ roomId, userId: auth.userId }, 'Joined interview room');
    } catch (error) {
      log.error({ err: error }, 'interview:join failed');
      ack?.({ ok: false, error: 'Could not join the interview room.' });
    }
  });

  socket.on(SocketEvent.INTERVIEW_LEAVE, async (payload: { roomId: string }) => {
    const room = interviewRoom(String(payload?.roomId ?? ''));
    socket.to(room).emit(SocketEvent.INTERVIEW_PARTICIPANT_LEFT, { socketId: socket.id, userId: auth.userId });
    await socket.leave(room);
  });

  socket.on(SocketEvent.INTERVIEW_CHAT, async (payload: { roomId: string; message: string; name: string }) => {
    const roomId = String(payload?.roomId ?? '');
    const message = String(payload?.message ?? '').slice(0, 2000);
    if (!message.trim()) return;

    const result = await authorizeRoom(roomId);
    if (!result.ok) return;

    const entry = {
      userId: auth.userId,
      name: String(payload?.name ?? auth.email).slice(0, 120),
      message,
      sentAt: new Date().toISOString(),
    };
    io.to(interviewRoom(roomId)).emit(SocketEvent.INTERVIEW_CHAT, entry);
    // Chat is persisted so it can be reviewed alongside the feedback form.
    await MentorshipSession.updateOne(
      { roomId },
      { $push: { chatLog: { userId: auth.userId, name: entry.name, message, sentAt: new Date() } } },
    );
  });

  /* ---- WebRTC signalling relay ---- */

  const relay = (event: string) => async (payload: { roomId: string; to?: string; data: unknown }) => {
    const roomId = String(payload?.roomId ?? '');
    const result = await authorizeRoom(roomId);
    if (!result.ok) return;

    const envelope = { from: socket.id, userId: auth.userId, data: payload.data };
    if (payload.to) {
      io.to(payload.to).emit(event, envelope);
    } else {
      socket.to(interviewRoom(roomId)).emit(event, envelope);
    }
  };

  socket.on(SocketEvent.RTC_OFFER, relay(SocketEvent.RTC_OFFER));
  socket.on(SocketEvent.RTC_ANSWER, relay(SocketEvent.RTC_ANSWER));
  socket.on(SocketEvent.RTC_ICE, relay(SocketEvent.RTC_ICE));

  /** Camera/mic on-off state, so each peer can show an accurate indicator (§15). */
  socket.on(SocketEvent.RTC_MEDIA_STATE, async (payload: { roomId: string; camera: boolean; microphone: boolean }) => {
    const roomId = String(payload?.roomId ?? '');
    const result = await authorizeRoom(roomId);
    if (!result.ok) return;
    socket.to(interviewRoom(roomId)).emit(SocketEvent.RTC_MEDIA_STATE, {
      socketId: socket.id,
      userId: auth.userId,
      camera: Boolean(payload.camera),
      microphone: Boolean(payload.microphone),
    });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room.startsWith('interview:')) {
        socket.to(room).emit(SocketEvent.INTERVIEW_PARTICIPANT_LEFT, { socketId: socket.id, userId: auth.userId });
      }
    }
  });
}
