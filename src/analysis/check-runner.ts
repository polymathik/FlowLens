/**
 * Core of `flowlens check`: cycle detection + architecture validation over a
 * loaded graph, producing the CheckReport contract and the exit code.
 * Kept separate from the CLI command so it is unit-testable.
 */

import type { GraphStore } from '../contracts/graph.js';
import type { CycleSeverity, DetectedCycle } from '../contracts/analysis/cycles.js';
import type { ArchitectureViolation } from '../contracts/analysis/architecture.js';
import { CHECK_EXIT, type CheckReport } from '../contracts/analysis/check.js';
import { detectCyclesInData } from './cycle-detector.js';
import { validateArchitectureData, buildLayerMap } from './architecture-validator.js';
import { loadArchConfig, describeArchConfigProblem } from './arch-config.js';
import { isInScope, normalizeScope } from './module-path.js';

export interface CheckRunOptions {
  flowlensDir: string;
  runCycles: boolean;
  runArchitecture: boolean;
  severity: CycleSeverity;
  scope?: string;
}

export interface CheckRunResult {
  report: CheckReport;
  exitCode: number;
  /** Configuration problems (missing/invalid architecture.json). */
  problems: string[];
}

export async function runCheck(graph: GraphStore, opts: CheckRunOptions): Promise<CheckRunResult> {
  const scope = normalizeScope(opts.scope);
  const [entities, edges] = await Promise.all([graph.getAllNodes(), graph.getAllEdges()]);
  const loaded = await loadArchConfig(opts.flowlensDir);
  const config = loaded.status === 'ok' ? loaded.config : null;
  const layerMap = config ? buildLayerMap(entities, config) : undefined;
  const problems: string[] = [];

  let cycles: DetectedCycle[] = [];
  if (opts.runCycles) {
    cycles = detectCyclesInData(entities, edges, {
      granularity: 'file',
      severity_threshold: opts.severity,
      scope,
      architecture: config,
      layerMap,
    });
  }

  let violations: ArchitectureViolation[] = [];
  let architecture: CheckReport['architecture'] = 'skipped';
  if (opts.runArchitecture) {
    if (config) {
      architecture = 'checked';
      violations = validateArchitectureData(entities, edges, config, layerMap)
        .filter((v) => isInScope(v.location.file, scope));
    } else {
      architecture = loaded.status === 'missing' ? 'missing' : 'invalid';
      problems.push(describeArchConfigProblem(loaded));
    }
  }

  const report: CheckReport = {
    timestamp: new Date().toISOString(),
    ...(scope ? { scope } : {}),
    severity_threshold: opts.severity,
    architecture,
    cycles: cycles.map((c) => ({
      severity: c.severity,
      granularity: c.granularity,
      path: c.path_labels ?? c.path ?? c.entities,
      members: c.length,
      severity_reasons: c.severity_reasons ?? [],
    })),
    architecture_violations: violations.map((v) => ({
      rule: v.rule,
      rule_text: v.rule_text ?? v.rule,
      layer_from: v.layer_from,
      layer_to: v.layer_to,
      from: v.entity_from_name ?? v.entity_from,
      to: v.entity_to_name ?? v.entity_to,
      relation_type: v.relation_type,
      location: `${v.location.file}:${v.location.line}`,
      ...(v.auto_fix_suggestion ? { suggestion: v.auto_fix_suggestion } : {}),
    })),
    summary: {
      cycles_found: cycles.length,
      violations_found: violations.length,
      severity_breakdown: {
        high: cycles.filter((c) => c.severity === 'high').length,
        medium: cycles.filter((c) => c.severity === 'medium').length,
        low: cycles.filter((c) => c.severity === 'low').length,
      },
    },
  };

  const exitCode = problems.length > 0
    ? CHECK_EXIT.error
    : cycles.length > 0 || violations.length > 0 ? CHECK_EXIT.issues : CHECK_EXIT.clean;
  return { report, exitCode, problems };
}
