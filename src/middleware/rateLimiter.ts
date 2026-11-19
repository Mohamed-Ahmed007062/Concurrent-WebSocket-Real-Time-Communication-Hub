import { env } from '../config/env.js';

interface SocketRateRecord {
  timestamps: number[];
}

export class SocketRateLimiter {
  private records = new Map<string, SocketRateRecord>();
  private readonly windowMs: number;
  private readonly maxLimit: number;

  constructor(windowMs = env.RATE_LIMIT_WINDOW_MS, maxLimit = env.RATE_LIMIT_MAX_MESSAGES) {
    this.windowMs = windowMs;
    this.maxLimit = maxLimit;
  }

  /**
   * Check whether a socket action is allowed under the current rate limit window.
   */
  public checkLimit(socketId: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    let record = this.records.get(socketId);

    if (!record) {
      record = { timestamps: [] };
      this.records.set(socketId, record);
    }

    // Filter out timestamps outside window
    const windowStart = now - this.windowMs;
    record.timestamps = record.timestamps.filter((t) => t > windowStart);

    if (record.timestamps.length >= this.maxLimit) {
      const oldestInWindow = record.timestamps[0];
      const retryAfterMs = Math.max(0, oldestInWindow + this.windowMs - now);
      return { allowed: false, retryAfterMs };
    }

    record.timestamps.push(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  /**
   * Cleanup socket record on disconnect to prevent memory leak
   */
  public cleanup(socketId: string): void {
    this.records.delete(socketId);
  }

  /**
   * Reset all records (for testing)
   */
  public reset(): void {
    this.records.clear();
  }
}

export const socketRateLimiter = new SocketRateLimiter();
