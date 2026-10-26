import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '@/services/api';

/**
 * Shared Socket.IO connection.
 *
 * One socket serves notifications, assessment timer ticks and the interview
 * room. It is created lazily after sign-in and torn down on sign-out, so an
 * anonymous visitor never opens a connection.
 */
let socket: Socket | null = null;

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? window.location.origin;

export function connectSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) return null;

  if (socket?.connected) return socket;

  socket?.disconnect();
  socket = io(SOCKET_URL, {
    path: '/socket.io',
    auth: { token },
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    // Backoff rather than hammering a server that may be restarting.
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** Re-authenticates the socket after a token refresh. */
export function refreshSocketAuth(): void {
  const token = getAccessToken();
  if (socket && token) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
  }
}
