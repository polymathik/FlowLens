/**
 * Barrel export of all diagnostic check runners. The order here is the order
 * they appear in the `flowlens doctor` output.
 */
import type { DiagnosticRunner } from '../../contracts/doctor.js';
import { flowlensDirCheck } from './flowlens-dir.js';
import { graphPopulatedCheck } from './graph-populated.js';
import { configValidCheck } from './config-valid.js';
import { architectureValidCheck } from './architecture-valid.js';
import { fileIndexCurrentCheck } from './file-index-current.js';
import { mcpReachableCheck } from './mcp-check.js';
import { aiConfiguredCheck } from './ai-check.js';
import {
  nodeVersionCheck,
  gitAvailableCheck,
  diskSpaceCheck,
} from './environment.js';

export const ALL_CHECKS: DiagnosticRunner[] = [
  flowlensDirCheck,
  graphPopulatedCheck,
  configValidCheck,
  architectureValidCheck,
  fileIndexCurrentCheck,
  mcpReachableCheck,
  aiConfiguredCheck,
  gitAvailableCheck,
  nodeVersionCheck,
  diskSpaceCheck,
];
