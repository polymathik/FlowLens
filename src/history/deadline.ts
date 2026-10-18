/** A time limit plus an AbortSignal, checked at safe points of long jobs. */
import { HistoryError } from '../contracts/history.js';

export class Deadline {
  private readonly at: number;
  constructor(timeoutMs: number, private readonly signal?: AbortSignal, private readonly what = 'sample') {
    this.at = Date.now() + timeoutMs;
  }

  /** Throws `HistoryError('aborted' | 'timeout')` once the signal fired or the time is up. */
  check(): void {
    if (this.signal?.aborted) throw new HistoryError('aborted', 'History build was cancelled');
    if (Date.now() > this.at) throw new HistoryError('timeout', `Timed out while reading ${this.what}`);
  }
}
