import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '@/services/socket';

/**
 * Peer-to-peer video for the alumni mock interview (§19).
 *
 * The server relays signalling only; audio and video travel directly between
 * the two participants. Media is never captured before the user grants consent,
 * and the local stream is fully released on leave — a lingering camera light
 * after a call is both a privacy failure and a trust failure.
 *
 * Glare handling: the peer that joins second issues the offer, so both sides do
 * not offer simultaneously.
 */
export interface MediaState {
  camera: boolean;
  microphone: boolean;
}

export interface ChatMessage {
  userId: string;
  name: string;
  message: string;
  sentAt: string;
}

export function useWebRTC(roomId: string, iceServers: RTCIceServer[], displayName: string) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | 'idle'>('idle');
  const [mediaState, setMediaState] = useState<MediaState>({ camera: false, microphone: false });
  const [remoteMediaState, setRemoteMediaState] = useState<MediaState>({ camera: false, microphone: false });
  const [peerPresent, setPeerPresent] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerSocketIdRef = useRef<string | null>(null);
  // Queues candidates that arrive before the remote description is applied.
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  const createPeerConnection = useCallback(() => {
    const connection = new RTCPeerConnection({ iceServers });

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        getSocket()?.emit('rtc:ice', {
          roomId,
          to: peerSocketIdRef.current ?? undefined,
          data: event.candidate.toJSON(),
        });
      }
    };

    connection.ontrack = (event) => {
      setRemoteStream(event.streams[0] ?? null);
    };

    connection.onconnectionstatechange = () => {
      setConnectionState(connection.connectionState);
      if (connection.connectionState === 'failed') {
        setError('The peer connection failed. This usually means a firewall is blocking direct media; a TURN server is required on restrictive networks.');
      }
    };

    // Re-attach any tracks already captured.
    localStreamRef.current?.getTracks().forEach((track) => {
      connection.addTrack(track, localStreamRef.current!);
    });

    peerRef.current = connection;
    return connection;
  }, [iceServers, roomId]);

  /** Requests camera/microphone. Called only after explicit consent (§15). */
  const startMedia = useCallback(async (constraints: MediaStreamConstraints = { video: true, audio: true }) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaState({
        camera: stream.getVideoTracks().some((t) => t.enabled),
        microphone: stream.getAudioTracks().some((t) => t.enabled),
      });

      // Attach to an existing connection if one is already open.
      const connection = peerRef.current;
      if (connection) {
        stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      }
      return stream;
    } catch (caught) {
      const name = (caught as DOMException).name;
      setError(
        name === 'NotAllowedError'
          ? 'Camera and microphone access was denied. You can still use chat, or grant permission in your browser settings.'
          : name === 'NotFoundError'
            ? 'No camera or microphone was found on this device.'
            : 'Could not access your camera or microphone.',
      );
      return null;
    }
  }, []);

  const join = useCallback(async () => {
    const socket = getSocket();
    if (!socket) {
      setError('The realtime connection is not available. Please reload the page.');
      return;
    }

    socket.emit('interview:join', { roomId }, async (response: { ok: boolean; error?: string; peers?: Array<{ socketId: string }> }) => {
      if (!response?.ok) {
        setError(response?.error ?? 'Could not join the interview room.');
        return;
      }

      setJoined(true);
      const connection = createPeerConnection();

      // A peer is already here, so this side initiates the offer.
      if (response.peers?.length) {
        peerSocketIdRef.current = response.peers[0].socketId;
        setPeerPresent(true);

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        socket.emit('rtc:offer', { roomId, to: peerSocketIdRef.current, data: offer });
      }
    });
  }, [createPeerConnection, roomId]);

  const leave = useCallback(() => {
    getSocket()?.emit('interview:leave', { roomId });

    // Release the camera and microphone completely.
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    peerRef.current?.close();
    peerRef.current = null;

    setLocalStream(null);
    setRemoteStream(null);
    setMediaState({ camera: false, microphone: false });
    setJoined(false);
    setPeerPresent(false);
    setConnectionState('idle');
  }, [roomId]);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const next = { camera: track.enabled, microphone: mediaState.microphone };
    setMediaState(next);
    getSocket()?.emit('rtc:media-state', { roomId, ...next });
  }, [mediaState.microphone, roomId]);

  const toggleMicrophone = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const next = { camera: mediaState.camera, microphone: track.enabled };
    setMediaState(next);
    getSocket()?.emit('rtc:media-state', { roomId, ...next });
  }, [mediaState.camera, roomId]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      getSocket()?.emit('interview:chat', { roomId, message: text.trim(), name: displayName });
    },
    [displayName, roomId],
  );

  /* ---- Signalling ---- */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onOffer = async ({ from, data }: { from: string; data: RTCSessionDescriptionInit }) => {
      peerSocketIdRef.current = from;
      setPeerPresent(true);

      const connection = peerRef.current ?? createPeerConnection();
      await connection.setRemoteDescription(new RTCSessionDescription(data));

      for (const candidate of pendingCandidates.current.splice(0)) {
        await connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      }

      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socket.emit('rtc:answer', { roomId, to: from, data: answer });
    };

    const onAnswer = async ({ from, data }: { from: string; data: RTCSessionDescriptionInit }) => {
      peerSocketIdRef.current = from;
      const connection = peerRef.current;
      if (!connection) return;
      await connection.setRemoteDescription(new RTCSessionDescription(data));
      for (const candidate of pendingCandidates.current.splice(0)) {
        await connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      }
    };

    const onIce = async ({ data }: { data: RTCIceCandidateInit }) => {
      const connection = peerRef.current;
      // Candidates can arrive before the remote description; queue them.
      if (!connection?.remoteDescription) {
        pendingCandidates.current.push(data);
        return;
      }
      await connection.addIceCandidate(new RTCIceCandidate(data)).catch(() => undefined);
    };

    const onParticipantJoined = async ({ socketId }: { socketId: string }) => {
      peerSocketIdRef.current = socketId;
      setPeerPresent(true);

      // The already-present peer offers when someone new arrives.
      const connection = peerRef.current ?? createPeerConnection();
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socket.emit('rtc:offer', { roomId, to: socketId, data: offer });
    };

    const onParticipantLeft = () => {
      setPeerPresent(false);
      setRemoteStream(null);
      setRemoteMediaState({ camera: false, microphone: false });
    };

    const onChat = (entry: ChatMessage) => setMessages((current) => [...current, entry]);

    const onRemoteMedia = ({ camera, microphone }: { camera: boolean; microphone: boolean }) =>
      setRemoteMediaState({ camera, microphone });

    socket.on('rtc:offer', onOffer);
    socket.on('rtc:answer', onAnswer);
    socket.on('rtc:ice', onIce);
    socket.on('interview:participant:joined', onParticipantJoined);
    socket.on('interview:participant:left', onParticipantLeft);
    socket.on('interview:chat', onChat);
    socket.on('rtc:media-state', onRemoteMedia);

    return () => {
      socket.off('rtc:offer', onOffer);
      socket.off('rtc:answer', onAnswer);
      socket.off('rtc:ice', onIce);
      socket.off('interview:participant:joined', onParticipantJoined);
      socket.off('interview:participant:left', onParticipantLeft);
      socket.off('interview:chat', onChat);
      socket.off('rtc:media-state', onRemoteMedia);
    };
  }, [createPeerConnection, roomId]);

  // Releasing media on unmount matters: otherwise the camera stays on after
  // the user navigates away.
  useEffect(() => () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    peerRef.current?.close();
  }, []);

  return {
    localStream, remoteStream, connectionState, mediaState, remoteMediaState,
    peerPresent, messages, error, joined,
    startMedia, join, leave, toggleCamera, toggleMicrophone, sendMessage,
  };
}
