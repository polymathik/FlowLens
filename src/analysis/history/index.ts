/**
 * Pure history analysis for the timeline UI — importable from the browser
 * bundle (no `node:*`, no third-party packages; see test/unit/history/purity.test.ts).
 * Input is the `HistorySummary` / `HistoryTopology` served by
 * `GET /api/projects/:id/canvas/history[/topology]`.
 */
export { growthByZone, type GrowthSeries, type ZoneGrowth, type ZoneOfPath } from './growth.js';
export { snapshotAt, recencyHeat, commitIndex, BEFORE_WINDOW, type HistorySnapshot, type SnapshotFile } from './snapshot.js';
export { topologyDiff, resolveSample, type TopologyDiff, type TopologyEdge, type SampleRef } from './topology-diff.js';
export { applyChange, applyCommit, newReplayState, type LiveFile, type ReplayState, type ReplayDelta } from './replay.js';
