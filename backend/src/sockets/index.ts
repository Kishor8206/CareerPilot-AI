import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { SocketEvent, UserRole } from '@careerpilot/shared';
import { env } from '../config/env';
import { moduleLogger } from '../config/logger';
import { verifyAccessToken } from '../services/token.service';
import { setSocketServer, userRoom } from './emitter';
import { registerInterviewHandlers } from './interview.socket';
import { registerAssessmentHandlers } from './assessment.socket';

const log = moduleLogger('socket');

export interface SocketAuth {
  userId: string;
  role: UserRole;
  email: string;
}

declare module 'socket.io' {
  interface Socket {
    auth?: SocketAuth;
  }
}

/**
 * `socket.data` is the only place Socket.IO carries per-connection state onto
 * `RemoteSocket` objects returned by `fetchSockets()`, so the identity is
 * written to both `socket.auth` (ergonomic in handlers) and `socket.data.auth`
 * (readable from other nodes/handlers).
 */
export interface AppSocketData {
  auth: SocketAuth;
}

export function initSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: env.SOCKET_PATH,
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    // Interview rooms need a forgiving timeout so a brief network blip does not
    // tear down an in-progress session.
    pingTimeout: 30_000,
    pingInterval: 25_000,
    maxHttpBufferSize: 1e6,
  });

  /**
   * Every socket must present the same JWT the REST API uses. Anonymous sockets
   * are rejected outright - there is no public real-time surface.
   */
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      next(new Error('UNAUTHENTICATED: a valid access token is required to open a realtime connection.'));
      return;
    }
    try {
      const payload = verifyAccessToken(token);
      const identity: SocketAuth = { userId: payload.sub, role: payload.role, email: payload.email };
      socket.auth = identity;
      socket.data.auth = identity;
      next();
    } catch {
      next(new Error('INVALID_TOKEN: the realtime connection could not be authenticated.'));
    }
  });

  io.on('connection', (socket) => {
    const auth = socket.auth!;
    socket.join(userRoom(auth.userId));
    log.debug({ userId: auth.userId, socketId: socket.id }, 'Socket connected');

    registerInterviewHandlers(io, socket);
    registerAssessmentHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      log.debug({ userId: auth.userId, socketId: socket.id, reason }, 'Socket disconnected');
    });

    socket.on('error', (err) => {
      log.warn({ err, userId: auth.userId }, 'Socket error');
    });

    // Lets the client confirm the realtime channel is alive (network indicator
    // in the full-screen assessment UI).
    socket.on('ping:check', (ack?: (value: { ok: true; at: number }) => void) => {
      ack?.({ ok: true, at: Date.now() });
    });
  });

  setSocketServer(io);
  log.info({ path: env.SOCKET_PATH }, 'Socket.IO server initialised');
  return io;
}

export { SocketEvent };
