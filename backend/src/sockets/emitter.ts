import type { Server } from 'socket.io';

/**
 * Holds the Socket.IO server instance so any service can emit without importing
 * the HTTP server (which would create a require cycle).
 */
let io: Server | null = null;

export function setSocketServer(server: Server) {
  io = server;
}

export function getSocketServer(): Server | null {
  return io;
}

/** Room name for a user's personal channel (all their open tabs/devices). */
export const userRoom = (userId: string) => `user:${userId}`;
/** Room name for a live interview/mentorship room. */
export const interviewRoom = (roomId: string) => `interview:${roomId}`;
/** Room name for an in-progress assessment attempt. */
export const attemptRoom = (attemptId: string) => `attempt:${attemptId}`;

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload);
}

export function emitToRoom(room: string, event: string, payload: unknown) {
  io?.to(room).emit(event, payload);
}

export function connectedUserCount(): number {
  return io ? io.sockets.sockets.size : 0;
}
