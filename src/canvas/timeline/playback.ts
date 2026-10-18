/**
 * Playback of the timeline: a deterministic tick function (no clocks, no
 * DOM — the driver feeds it elapsed time) and the speeds. Pure.
 *
 * 1× is `BASE_RATE` commits per second, so each step is on screen long
 * enough for its fade-in and pulse; 4× and 16× just advance several commits
 * per rendered frame. The fractional part of a frame's advance is carried so
 * the average speed is exact whatever the frame rate.
 */
export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

/** Commits per second at 1×. */
export const BASE_RATE = 4;
/** The driver renders at most this many frames per second. */
export const MAX_FPS = 12;
/** One frame never advances time by more than this (a background tab must not fast-forward the history). */
export const MAX_FRAME_MS = 250;

export interface PlayState {
  index: number;
  /** Commits advanced but not yet whole. */
  carry: number;
}

export interface TickResult extends PlayState {
  /** The playhead reached the newest commit: stop playing. */
  done: boolean;
}

/** Advance by `dtMs` of wall time at `speed`, never past `last`. */
export function tick(state: PlayState, dtMs: number, speed: number, last: number): TickResult {
  if (state.index >= last) return { index: Math.max(0, last), carry: 0, done: true };
  const dt = Math.max(0, Math.min(dtMs, MAX_FRAME_MS));
  const exact = state.carry + (dt / 1000) * BASE_RATE * speed;
  const whole = Math.floor(exact);
  const index = Math.min(last, state.index + whole);
  return { index, carry: index >= last ? 0 : exact - whole, done: index >= last };
}

/** Where pressing play starts: from the beginning when the playhead sits at the newest commit. */
export const playStart = (index: number, last: number): number => (index >= last ? 0 : index);

export const clampIndex = (i: number, count: number): number => Math.max(0, Math.min(Math.trunc(i), Math.max(0, count - 1)));
