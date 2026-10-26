import { describe, expect, it } from 'vitest';
import {
  BAND_LABEL, BAND_TONE, formatDuration, formatPercent, formatScore, initials, scoreTone, titleCase,
} from '@/utils/format';

/**
 * These functions decide what a student actually reads on screen, so the
 * distinctions they draw matter more than their line count.
 */
describe('score formatting', () => {
  it('distinguishes "no evidence" from a genuine zero', () => {
    // This is the single most important distinction in the UI: telling a student
    // they scored 0 on something they never attempted would be false.
    expect(formatScore(null)).toBe('—');
    expect(formatScore(undefined)).toBe('—');
    expect(formatScore(0)).toBe('0');
  });

  it('rounds to one decimal place', () => {
    expect(formatScore(72.456)).toBe('72.5');
    expect(formatScore(72.4)).toBe('72.4');
  });

  it('appends a suffix when given one', () => {
    expect(formatScore(85, '%')).toBe('85%');
  });

  it('formats percentages, preserving the null case', () => {
    expect(formatPercent(42.34)).toBe('42.3%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('score tone', () => {
  it('maps scores onto the shared red/amber/green scale', () => {
    expect(scoreTone(85)).toBe('success');
    expect(scoreTone(70)).toBe('success');
    expect(scoreTone(69.9)).toBe('warning');
    expect(scoreTone(50)).toBe('warning');
    expect(scoreTone(49.9)).toBe('danger');
    expect(scoreTone(0)).toBe('danger');
  });

  it('uses a neutral tone for absent scores rather than red', () => {
    // A missing score is not a bad score, and must not be coloured like one.
    expect(scoreTone(null)).toBe('muted');
    expect(scoreTone(undefined)).toBe('muted');
  });
});

describe('readiness bands', () => {
  it('labels every band in readable prose', () => {
    expect(BAND_LABEL.AT_RISK).toBe('At Risk');
    expect(BAND_LABEL.NEEDS_IMPROVEMENT).toBe('Needs Improvement');
    expect(BAND_LABEL.PLACEMENT_READY).toBe('Placement Ready');
    expect(BAND_LABEL.HIGHLY_READY).toBe('Highly Ready');
  });

  it('colours bands consistently with their meaning', () => {
    expect(BAND_TONE.AT_RISK).toBe('danger');
    expect(BAND_TONE.NEEDS_IMPROVEMENT).toBe('warning');
    expect(BAND_TONE.PLACEMENT_READY).toBe('success');
    expect(BAND_TONE.HIGHLY_READY).toBe('success');
  });
});

describe('assessment timer', () => {
  it('formats mm:ss below an hour', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(59)).toBe('00:59');
    expect(formatDuration(90)).toBe('01:30');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('switches to hh:mm:ss at an hour', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('never displays a negative time', () => {
    // The timer can briefly go negative between the deadline and auto-submit.
    expect(formatDuration(-30)).toBe('00:00');
  });
});

describe('text helpers', () => {
  it('builds initials from a name', () => {
    expect(initials('Priya Sharma')).toBe('PS');
    expect(initials('Aarthi')).toBe('A');
    expect(initials('Dr. Lakshmi Narayanan Iyer')).toBe('DL');
  });

  it('converts enum values into readable labels', () => {
    expect(titleCase('PLACEMENT_READY')).toBe('Placement Ready');
    expect(titleCase('COMPANY_SPECIFIC')).toBe('Company Specific');
  });
});
