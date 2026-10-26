import { useCallback, useEffect, useRef, useState } from 'react';
import type { MonitoringEventType } from '@careerpilot/shared';
import { apiPost, apiPut } from '@/services/api';
import { getSocket } from '@/services/socket';

/**
 * Full-screen assessment session mechanics (§13, §14).
 *
 * Responsibilities kept here so the page component stays declarative:
 *  - full-screen enter/exit via the browser Fullscreen API
 *  - a server-authoritative countdown (the socket supplies the truth; the local
 *    tick only smooths the display between server ticks)
 *  - debounced autosave with an offline queue
 *  - integrity-signal capture, batched and flushed
 *  - refresh/close protection while answers are unsaved
 */

const AUTOSAVE_DEBOUNCE_MS = 1500;
const MONITORING_FLUSH_MS = 5000;
const INACTIVITY_THRESHOLD_MS = 120_000;

export interface AnswerState {
  questionId: string;
  answer: string[] | null;
  markedForReview: boolean;
  timeSpentSeconds: number;
}

export type SaveStatus = 'saved' | 'saving' | 'pending' | 'error' | 'offline';

interface Options {
  attemptId: string;
  expiresAt: string;
  serverTime: number;
  requiresFullscreen: boolean;
  onExpire: () => void;
}

export function useAssessmentSession({
  attemptId,
  expiresAt,
  serverTime,
  requiresFullscreen,
  onExpire,
}: Options) {
  /* ---- Clock ------------------------------------------------------- */

  // The gap between the browser clock and the server clock. Applying it means a
  // student with a skewed system clock still sees the correct remaining time.
  const clockSkewRef = useRef(Date.now() - serverTime);
  const deadlineRef = useRef(new Date(expiresAt).getTime());

  const computeRemaining = useCallback(() => {
    const serverNow = Date.now() - clockSkewRef.current;
    return Math.max(0, Math.floor((deadlineRef.current - serverNow) / 1000));
  }, []);

  const [remainingSeconds, setRemainingSeconds] = useState(computeRemaining);
  const expiredRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = computeRemaining();
      setRemainingSeconds(remaining);
      if (remaining <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [computeRemaining, onExpire]);

  // The server tick is authoritative and corrects any accumulated drift.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('assessment:subscribe', { attemptId });

    const onTick = (payload: { attemptId: string; remainingSeconds: number; serverTime: number }) => {
      if (payload.attemptId !== attemptId) return;
      clockSkewRef.current = Date.now() - payload.serverTime;
      setRemainingSeconds(payload.remainingSeconds);
    };

    socket.on('assessment:tick', onTick);
    return () => {
      socket.off('assessment:tick', onTick);
      socket.emit('assessment:unsubscribe', { attemptId });
    };
  }, [attemptId]);

  /* ---- Network status ---------------------------------------------- */

  const [online, setOnline] = useState(navigator.onLine);

  /* ---- Integrity monitoring ---------------------------------------- */

  const monitoringQueue = useRef<Array<{ type: MonitoringEventType; metadata?: Record<string, unknown> }>>([]);
  const [eventCount, setEventCount] = useState(0);
  const [integrityRisk, setIntegrityRisk] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
  const [integrityNotice, setIntegrityNotice] = useState<string | null>(null);

  const recordEvent = useCallback((type: MonitoringEventType, metadata?: Record<string, unknown>) => {
    monitoringQueue.current.push({ type, metadata });
    setEventCount((count) => count + 1);
  }, []);

  const flushMonitoring = useCallback(async () => {
    if (!monitoringQueue.current.length) return;
    const batch = monitoringQueue.current.splice(0, monitoringQueue.current.length);
    try {
      const result = await apiPost<{ integrityRisk: 'LOW' | 'MEDIUM' | 'HIGH'; notice: string | null }>(
        `/assessments/attempts/${attemptId}/monitoring`,
        { events: batch },
      );
      setIntegrityRisk(result.integrityRisk);
      setIntegrityNotice(result.notice);
    } catch {
      // Re-queue so a transient failure does not lose the signals. They are
      // advisory, so losing them is not fatal, but the record should be complete.
      monitoringQueue.current.unshift(...batch);
    }
  }, [attemptId]);

  useEffect(() => {
    const interval = setInterval(() => void flushMonitoring(), MONITORING_FLUSH_MS);
    return () => {
      clearInterval(interval);
      void flushMonitoring();
    };
  }, [flushMonitoring]);

  /* ---- Full-screen -------------------------------------------------- */

  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      document.documentElement.classList.add('assessment-mode');
      return true;
    } catch {
      // Refused (browser policy, or an unsupported environment). The assessment
      // still runs; the student is told full-screen could not be entered.
      return false;
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    document.documentElement.classList.remove('assessment-mode');
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Already exited.
      }
    }
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (requiresFullscreen) {
        recordEvent(active ? 'FULLSCREEN_ENTER' : 'FULLSCREEN_EXIT');
      }
    }

    function onVisibilityChange() {
      recordEvent(document.hidden ? 'TAB_HIDDEN' : 'TAB_VISIBLE');
    }

    function onBlur() {
      recordEvent('WINDOW_BLUR');
    }

    function onFocus() {
      recordEvent('WINDOW_FOCUS');
    }

    function onCopy() {
      recordEvent('COPY');
    }

    function onPaste() {
      recordEvent('PASTE');
    }

    function onOnline() {
      setOnline(true);
      recordEvent('NETWORK_ONLINE');
    }

    function onOffline() {
      setOnline(false);
      recordEvent('NETWORK_OFFLINE');
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [recordEvent, requiresFullscreen]);

  /* ---- Inactivity --------------------------------------------------- */

  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll'] as const;
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > INACTIVITY_THRESHOLD_MS) {
        recordEvent('INACTIVITY', { seconds: Math.round((Date.now() - lastActivityRef.current) / 1000) });
        lastActivityRef.current = Date.now();
      }
    }, 30_000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, markActive));
      clearInterval(interval);
    };
  }, [recordEvent]);

  /* ---- Autosave ----------------------------------------------------- */

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const pendingRef = useRef<Map<string, AnswerState>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushAutosave = useCallback(async () => {
    if (!pendingRef.current.size) return;

    const answers = [...pendingRef.current.values()];
    setSaveStatus('saving');

    try {
      await apiPut(`/assessments/attempts/${attemptId}/autosave`, {
        answers: answers.map((a) => ({
          questionId: a.questionId,
          answer: a.answer,
          markedForReview: a.markedForReview,
          timeSpentSeconds: a.timeSpentSeconds,
        })),
      });
      pendingRef.current.clear();
      setSaveStatus('saved');
      setLastSavedAt(new Date());
    } catch {
      // Answers stay queued and are retried on the next change or on submit, so
      // a network blip never costs the student their work.
      setSaveStatus(navigator.onLine ? 'error' : 'offline');
    }
  }, [attemptId]);

  const queueAutosave = useCallback(
    (answer: AnswerState) => {
      pendingRef.current.set(answer.questionId, answer);
      setSaveStatus('pending');

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flushAutosave(), AUTOSAVE_DEBOUNCE_MS);
    },
    [flushAutosave],
  );

  // Retry as soon as connectivity returns.
  useEffect(() => {
    if (online && (saveStatus === 'offline' || saveStatus === 'error')) {
      void flushAutosave();
    }
  }, [online, saveStatus, flushAutosave]);

  /* ---- Refresh / close protection (§13) ----------------------------- */

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (pendingRef.current.size > 0 || remainingSeconds > 0) {
        event.preventDefault();
        // Browsers show their own generic wording; the value is unused but the
        // assignment is what triggers the prompt.
        event.returnValue = '';
        return '';
      }
      return undefined;
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [remainingSeconds]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.documentElement.classList.remove('assessment-mode');
    },
    [],
  );

  return {
    remainingSeconds,
    saveStatus,
    lastSavedAt,
    online,
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
    queueAutosave,
    flushAutosave,
    recordEvent,
    flushMonitoring,
    integrityRisk,
    integrityNotice,
    monitoringEventCount: eventCount,
  };
}
