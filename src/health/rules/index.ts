/**
 * Rule registry. Each rule is a small module producing findings for one
 * concern; the engine runs them in this order (order does not affect
 * output — ranking sorts deterministically afterwards).
 */
import type { HealthRule } from '../finding.js';
import { boundaryRule } from './boundary.js';
import { complexFunctionRule } from './complex-function.js';
import { cycleRule } from './cycles.js';
import { fragileHubRule } from './fragile-hub.js';
import { orphanRule, unresolvedImportsRule } from './graph-gaps.js';
import { hotspotRule } from './hotspot.js';
import { sizeRule } from './size.js';

export const HEALTH_RULES: HealthRule[] = [
  cycleRule,
  boundaryRule,
  complexFunctionRule,
  hotspotRule,
  sizeRule,
  fragileHubRule,
  orphanRule,
  unresolvedImportsRule,
];
