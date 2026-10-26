import {
  DEFAULT_APIE_MODIFIERS,
  DEFAULT_APIE_WEIGHTS,
  DEFAULT_READINESS_BANDS,
  DEFAULT_REASSESSMENT_DAYS,
  MonitoringEventType,
  RiskLevel,
  type ApieComponentKey,
  type ReadinessBand,
} from '@careerpilot/shared';
import { CONFIG_KEYS, SystemConfiguration } from '../models/SystemConfiguration';
import { PlacementReadiness } from '../models/PlacementReadiness';
import { moduleLogger } from '../config/logger';

const log = moduleLogger('config');

export type ApieWeights = Record<ApieComponentKey, number>;
export interface ApieModifiers {
  projectBonusMax: number;
  projectCap: number;
  certificationBonusMax: number;
  certificationCap: number;
  internshipBonusMax: number;
  internshipCap: number;
  alumniFeedbackInfluence: number;
  missingComponentPenalty: number;
}
export type ReadinessBandConfig = Array<{ band: ReadinessBand; min: number; max: number }>;
export type MonitoringSeverityMap = Record<string, RiskLevel>;
export interface MonitoringThresholds {
  mediumScore: number;
  highScore: number;
  severityPoints: Record<RiskLevel, number>;
}

/**
 * Default monitoring severities (§14).
 *
 * Note the deliberate calibration: leaving fullscreen or switching tabs is a
 * MEDIUM signal, not proof of misconduct. Nothing here is HIGH on its own -
 * HIGH is reached only by accumulating points, and even then it is routed to a
 * human reviewer rather than failing the attempt.
 */
const DEFAULT_MONITORING_SEVERITY: MonitoringSeverityMap = {
  [MonitoringEventType.FULLSCREEN_EXIT]: RiskLevel.MEDIUM,
  [MonitoringEventType.FULLSCREEN_ENTER]: RiskLevel.LOW,
  [MonitoringEventType.TAB_HIDDEN]: RiskLevel.MEDIUM,
  [MonitoringEventType.TAB_VISIBLE]: RiskLevel.LOW,
  [MonitoringEventType.WINDOW_BLUR]: RiskLevel.LOW,
  [MonitoringEventType.WINDOW_FOCUS]: RiskLevel.LOW,
  [MonitoringEventType.COPY]: RiskLevel.LOW,
  [MonitoringEventType.PASTE]: RiskLevel.MEDIUM,
  [MonitoringEventType.INACTIVITY]: RiskLevel.LOW,
  [MonitoringEventType.RAPID_ANSWER]: RiskLevel.MEDIUM,
  [MonitoringEventType.NETWORK_OFFLINE]: RiskLevel.LOW,
  [MonitoringEventType.NETWORK_ONLINE]: RiskLevel.LOW,
  [MonitoringEventType.MULTIPLE_SESSION]: RiskLevel.HIGH,
  [MonitoringEventType.FACE_NOT_DETECTED]: RiskLevel.LOW,
  [MonitoringEventType.MULTIPLE_FACES]: RiskLevel.MEDIUM,
  [MonitoringEventType.CAMERA_UNAVAILABLE]: RiskLevel.LOW,
  [MonitoringEventType.SESSION_RESUMED]: RiskLevel.LOW,
};

const DEFAULT_MONITORING_THRESHOLDS: MonitoringThresholds = {
  mediumScore: 6,
  highScore: 14,
  severityPoints: { [RiskLevel.LOW]: 1, [RiskLevel.MEDIUM]: 3, [RiskLevel.HIGH]: 6 },
};

const DEFAULTS: Record<string, { value: unknown; description: string; category: 'APIE' | 'AI' | 'MONITORING' | 'ASSESSMENT' | 'PRIVACY' | 'GENERAL' }> = {
  [CONFIG_KEYS.APIE_WEIGHTS]: {
    value: { ...DEFAULT_APIE_WEIGHTS },
    description:
      'Weights of the Placement Readiness Score components. PROTOTYPE MODEL - not empirically validated. Must sum to 1.',
    category: 'APIE',
  },
  [CONFIG_KEYS.APIE_MODIFIERS]: {
    value: { ...DEFAULT_APIE_MODIFIERS },
    description: 'Bonus/penalty caps applied on top of the weighted base score (projects, certifications, alumni feedback).',
    category: 'APIE',
  },
  [CONFIG_KEYS.APIE_BANDS]: {
    value: DEFAULT_READINESS_BANDS,
    description: 'Score cut-offs mapping the 0-100 PRS onto the four readiness bands.',
    category: 'APIE',
  },
  [CONFIG_KEYS.APIE_REASSESSMENT_DAYS]: {
    value: DEFAULT_REASSESSMENT_DAYS,
    description: 'Age in days after which a component score is considered stale and reassessment is suggested.',
    category: 'APIE',
  },
  [CONFIG_KEYS.MONITORING_SEVERITY]: {
    value: DEFAULT_MONITORING_SEVERITY,
    description: 'Severity assigned to each assessment-integrity signal. Advisory only; never auto-fails a student.',
    category: 'MONITORING',
  },
  [CONFIG_KEYS.MONITORING_THRESHOLDS]: {
    value: DEFAULT_MONITORING_THRESHOLDS,
    description: 'Accumulated point thresholds that move an attempt to MEDIUM or HIGH integrity risk for human review.',
    category: 'MONITORING',
  },
  [CONFIG_KEYS.PRIVACY_RETENTION]: {
    value: { resumeDays: 365, recordingDays: 30, monitoringEventDays: 180, aiInteractionDays: 90 },
    description: 'Data-retention windows in days, enforced by the retention job (§30).',
    category: 'PRIVACY',
  },
};

/**
 * Cached configuration reader. Values live in MongoDB so administrators can
 * retune them at runtime; a short TTL keeps hot paths (APIE, monitoring) from
 * hitting the database on every call.
 */
class ConfigService {
  private cache = new Map<string, { value: unknown; expiresAt: number }>();
  private ttlMs = 60_000;

  async get<T>(key: string, fallback: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;

    try {
      const doc = await SystemConfiguration.findOne({ key }).lean();
      const value = (doc?.value ?? fallback) as T;
      this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
      return value;
    } catch (error) {
      // Configuration must never take the request path down; fall back to code
      // defaults and surface the problem in the logs.
      log.error({ err: error, key }, 'Failed to read configuration; using default');
      return fallback;
    }
  }

  async set(key: string, value: unknown, updatedBy?: string): Promise<void> {
    const meta = DEFAULTS[key];
    await SystemConfiguration.findOneAndUpdate(
      { key },
      {
        $set: {
          value,
          updatedBy: updatedBy ?? null,
          ...(meta ? { description: meta.description, category: meta.category } : {}),
        },
      },
      { upsert: true, new: true },
    );
    this.cache.delete(key);
  }

  invalidate(key?: string) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  /** Seeds any missing configuration rows. Safe to run on every boot. */
  async bootstrap(): Promise<void> {
    for (const [key, meta] of Object.entries(DEFAULTS)) {
      const exists = await SystemConfiguration.exists({ key });
      if (!exists) {
        await SystemConfiguration.create({
          key,
          value: meta.value,
          description: meta.description,
          category: meta.category,
        });
        log.info({ key }, 'Seeded default configuration');
      }
    }
    await this.migrateApieWeights();
    await this.pruneRemovedComponents();
  }

  /**
   * Readiness records computed before a component was removed still list it,
   * and every screen that renders a record would keep showing it. The stale
   * entries are dropped from stored records; the scores themselves are left as
   * they were computed, because history should not be rewritten.
   */
  private async pruneRemovedComponents(): Promise<void> {
    const current = Object.keys(DEFAULT_APIE_WEIGHTS);
    const result = await PlacementReadiness.updateMany(
      // $elemMatch: "some component is retired". A bare $nin on the array path
      // would mean "no component is current", which matches nothing.
      { components: { $elemMatch: { key: { $nin: current } } } },
      { $pull: { components: { key: { $nin: current } } } },
    );
    if (result.modifiedCount) {
      log.warn({ records: result.modifiedCount }, 'Removed retired components from stored readiness records');
    }
  }

  /**
   * Stored readiness weights can outlive the components they refer to.
   *
   * When a component is removed from the platform (Group Discussion was), a
   * database written before the change still holds a weight for it. The engine
   * would keep reserving that share of the score for evidence that can no
   * longer exist, silently lowering every student's readiness. If the stored
   * keys do not match the current components exactly, the weights are reset to
   * the current defaults and the change is logged.
   */
  private async migrateApieWeights(): Promise<void> {
    const doc = await SystemConfiguration.findOne({ key: CONFIG_KEYS.APIE_WEIGHTS });
    if (!doc) return;
    const stored = Object.keys((doc.value ?? {}) as Record<string, number>).sort();
    const current = Object.keys(DEFAULT_APIE_WEIGHTS).sort();
    if (stored.join(',') === current.join(',')) return;

    const removed = stored.filter((k) => !current.includes(k));
    doc.value = { ...DEFAULT_APIE_WEIGHTS };
    doc.markModified('value');
    await doc.save();
    this.invalidate(CONFIG_KEYS.APIE_WEIGHTS);
    log.warn({ removed, weights: doc.value }, 'Readiness weights reset: stored components no longer match the platform');
  }

  /* ---- typed accessors used by the domain services ---- */

  getApieWeights(): Promise<ApieWeights> {
    return this.get<ApieWeights>(CONFIG_KEYS.APIE_WEIGHTS, { ...DEFAULT_APIE_WEIGHTS });
  }

  getApieModifiers(): Promise<ApieModifiers> {
    return this.get<ApieModifiers>(CONFIG_KEYS.APIE_MODIFIERS, { ...DEFAULT_APIE_MODIFIERS });
  }

  getReadinessBands(): Promise<ReadinessBandConfig> {
    return this.get<ReadinessBandConfig>(CONFIG_KEYS.APIE_BANDS, DEFAULT_READINESS_BANDS);
  }

  getReassessmentDays(): Promise<number> {
    return this.get<number>(CONFIG_KEYS.APIE_REASSESSMENT_DAYS, DEFAULT_REASSESSMENT_DAYS);
  }

  getMonitoringSeverity(): Promise<MonitoringSeverityMap> {
    return this.get<MonitoringSeverityMap>(CONFIG_KEYS.MONITORING_SEVERITY, DEFAULT_MONITORING_SEVERITY);
  }

  getMonitoringThresholds(): Promise<MonitoringThresholds> {
    return this.get<MonitoringThresholds>(CONFIG_KEYS.MONITORING_THRESHOLDS, DEFAULT_MONITORING_THRESHOLDS);
  }

  async listAll() {
    return SystemConfiguration.find().sort({ category: 1, key: 1 }).lean();
  }
}

export const configService = new ConfigService();
export { DEFAULT_MONITORING_SEVERITY, DEFAULT_MONITORING_THRESHOLDS };
