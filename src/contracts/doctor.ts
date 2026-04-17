/**
 * Doctor contract — diagnostic health-check results for `flowlens doctor`.
 *
 * Each `DiagnosticCheck` is self-contained and idempotent. Checks never
 * mutate state. Severity comes in three tiers:
 *   - ok:      the thing works as expected
 *   - warning: recoverable / advisory (e.g. file index stale)
 *   - error:   fatal for core operation (e.g. .flowlens/ missing)
 *
 * A `DoctorReport` aggregates check results. `overall` rolls up via the
 * worst status present: any `error` → overall error; else any `warning` →
 * overall warning; else `ok`.
 */

export type DiagnosticStatus = 'ok' | 'warning' | 'error';

export interface DiagnosticCheck {
  /** Short identifier, e.g. `flowlens-dir-exists`. Stable across versions. */
  name: string;
  /** Human-readable title shown in the CLI output. */
  title: string;
  status: DiagnosticStatus;
  /** One-line human message (shown beside the ✓/⚠/✗ glyph). */
  message: string;
  /** Optional extra detail (shown indented on the next line). */
  details?: string;
}

export interface DoctorReport {
  checks: DiagnosticCheck[];
  overall: DiagnosticStatus;
  timestamp: string;
}

/**
 * A single check function. Returns a DiagnosticCheck describing its result.
 * Checks should never throw — catch internally and report `error` status.
 */
export type DiagnosticRunner = (ctx: DoctorContext) => Promise<DiagnosticCheck>;

export interface DoctorContext {
  rootDir: string;
  flowlensDir: string;
}

export interface Doctor {
  diagnose(rootDir: string): Promise<DoctorReport>;
}
