/**
 * Token-bucket rate limiter, one bucket per session key (client address
 * or explicit session header). Refills continuously.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity = 30,
    private readonly refillPerSecond = 10,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true when the request is admitted. */
  take(key: string): boolean {
    const at = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, updatedAt: at };
      this.buckets.set(key, bucket);
    }
    const elapsed = (at - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
    bucket.updatedAt = at;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
