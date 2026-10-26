import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Voice preferences, persisted per browser.
 *
 * These are conveniences, not session state: a student who prefers a slower
 * reading pace should not have to set it again on every interview. Nothing here
 * affects scoring.
 */
interface VoiceState {
  /** Master switch. Off means the experience is text-only end to end. */
  enabled: boolean;
  /** Read AI questions and panellist turns aloud. */
  speakEnabled: boolean;
  /** Offer the microphone for answers. */
  micEnabled: boolean;
  /** Start listening automatically once the AI finishes speaking. */
  autoListen: boolean;
  voiceId: string | null;
  rate: number;
  language: string;
  /** Suppresses the first-run explainer once the student has seen it. */
  onboarded: boolean;

  setEnabled: (value: boolean) => void;
  setSpeakEnabled: (value: boolean) => void;
  setMicEnabled: (value: boolean) => void;
  setAutoListen: (value: boolean) => void;
  setVoiceId: (id: string | null) => void;
  setRate: (rate: number) => void;
  setLanguage: (language: string) => void;
  markOnboarded: () => void;
}

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      // Voice is opt-in. Auto-playing audio on page load is hostile, and some
      // browsers block it outright.
      enabled: false,
      speakEnabled: true,
      micEnabled: true,
      autoListen: false,
      voiceId: null,
      // Slightly below conversational pace: interview questions carry detail
      // the student needs to retain.
      rate: 0.95,
      language: 'en-IN',
      onboarded: false,

      setEnabled: (enabled) => set({ enabled }),
      setSpeakEnabled: (speakEnabled) => set({ speakEnabled }),
      setMicEnabled: (micEnabled) => set({ micEnabled }),
      setAutoListen: (autoListen) => set({ autoListen }),
      setVoiceId: (voiceId) => set({ voiceId }),
      setRate: (rate) => set({ rate: Math.min(2, Math.max(0.5, rate)) }),
      setLanguage: (language) => set({ language }),
      markOnboarded: () => set({ onboarded: true }),
    }),
    { name: 'careerpilot-voice' },
  ),
);
