import IORedis from "ioredis";

export interface CacheProvider {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class CacheService {
  constructor(private readonly provider: CacheProvider) {}

  async get<T>(key: string) {
    return this.provider.get<T>(key);
  }

  async set(key: string, value: unknown, ttl?: number) {
    await this.provider.set(key, value, ttl);
  }

  async wrap<T>(key: string, fn: () => Promise<T>, ttl = 60) {
    const cached = await this.provider.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
    const fresh = await fn();
    await this.provider.set(key, fresh, ttl);
    return fresh;
  }

  async delete(key: string) {
    await this.provider.delete(key);
  }
}

class MemoryCacheProvider implements CacheProvider {
  private cache = new Map<string, { value: unknown; expiresAt?: number }>();

  async get(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: unknown, ttl?: number) {
    this.cache.set(key, {
      value,
      expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
    });
  }

  async delete(key: string) {
    this.cache.delete(key);
  }
}

class RedisCacheProvider implements CacheProvider {
  private client: IORedis;
  constructor() {
    this.client = new IORedis({
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      keyPrefix: "fast-next:"
    });
  }

  async get(key: string) {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set(key: string, value: unknown, ttl?: number) {
    const payload = JSON.stringify(value);
    if (ttl) {
      await this.client.setex(key, ttl, payload);
    } else {
      await this.client.set(key, payload);
    }
  }

  async delete(key: string) {
    await this.client.del(key);
  }
}

type CacheProviderName = "memory" | "redis" | "upstash";

export function createCacheService(providerName: CacheProviderName = "redis") {
  const resolved = (process.env.CACHE_PROVIDER ?? providerName) as CacheProviderName;
  switch (resolved) {
    case "redis":
      return new CacheService(new RedisCacheProvider());
    case "upstash":
      return new CacheService(new UpstashCacheProvider());
    default:
      return new CacheService(new MemoryCacheProvider());
  }
}

export const cache = createCacheService();
