export class RateLimiter {
  private buckets = new Map<string, { count: number; until: number }>();
  constructor(private limit: number, private windowMs = 60_000, private maxKeys = 10_000) {}
  allow(key: string, now = Date.now()) {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.until > now) { if (bucket.count >= this.limit) return false; bucket.count++; return true; }
    if (this.buckets.size >= this.maxKeys) {
      for (const [id, value] of this.buckets) if (value.until <= now) this.buckets.delete(id);
      if (this.buckets.size >= this.maxKeys) return false;
    }
    this.buckets.set(key, { count: 1, until: now + this.windowMs });
    return true;
  }
}
