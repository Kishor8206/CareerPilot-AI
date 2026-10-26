import { describe, expect, it } from 'vitest';
import { stripForSpeech } from '@/services/speech';
import { toRecognitionError } from '@/services/speech/types';

/**
 * The speech layer's job is to make generated text sound right when read aloud,
 * and to turn raw engine errors into something a student can act on.
 */
describe('stripForSpeech', () => {
  it('removes markdown that a speech engine would pronounce literally', () => {
    expect(stripForSpeech('**Explain** the `useState` hook')).toBe('Explain the useState hook');
    expect(stripForSpeech('## Question one')).toBe('Question one');
  });

  it('reads complexity notation as words', () => {
    // "O(n log n)" is otherwise read as "oh parenthesis n log n parenthesis".
    expect(stripForSpeech('The complexity is O(n log n)')).toBe('The complexity is order n log n');
  });

  it('replaces code fences rather than reading their contents', () => {
    const spoken = stripForSpeech('Consider this:\n```js\nconst x = 1;\n```\nWhat does it print?');
    expect(spoken).not.toContain('const');
    expect(spoken).toContain('code block');
  });

  it('turns dashes into pauses so sentences do not run together', () => {
    expect(stripForSpeech('First — then second')).toBe('First, then second');
  });

  it('collapses whitespace and trims', () => {
    expect(stripForSpeech('  spaced    out  ')).toBe('spaced out');
  });

  it('leaves ordinary prose untouched', () => {
    const plain = 'Tell me about a project you are proud of.';
    expect(stripForSpeech(plain)).toBe(plain);
  });
});

describe('toRecognitionError', () => {
  it('tells the student how to fix a denied permission', () => {
    const error = toRecognitionError('not-allowed');
    expect(error.code).toBe('permission-denied');
    expect(error.requiresUserAction).toBe(true);
    expect(error.message).toMatch(/address bar/i);
    // Every error must name the way out, so voice failing never blocks the interview.
    expect(error.message).toMatch(/type your answer/i);
  });

  it('treats a missing microphone as needing user action', () => {
    const error = toRecognitionError('audio-capture');
    expect(error.code).toBe('no-microphone');
    expect(error.requiresUserAction).toBe(true);
  });

  it('treats silence as retryable rather than as a fault', () => {
    const error = toRecognitionError('no-speech');
    expect(error.code).toBe('no-speech');
    expect(error.requiresUserAction).toBe(false);
  });

  it('treats a network drop as retryable', () => {
    expect(toRecognitionError('network').requiresUserAction).toBe(false);
  });

  it('falls back to an actionable message for an unknown code', () => {
    const error = toRecognitionError('something-unexpected');
    expect(error.code).toBe('unknown');
    expect(error.message).toMatch(/type your answer/i);
  });
});
