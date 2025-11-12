import IORedis from "ioredis";

export interface CacheProvider {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}


class MemoryCacheProvider implements CacheProvider {
  private cache = new Map<string, { value: unknown; expiresAt?: number }>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value as T;
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
      keyPrefix: "fast-next:",
    });
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? (JSON.parse(value) as T) : null;
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

class UpstashCacheProvider implements CacheProvider {
  private readonly url: string;
  private readonly token: string;

  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error("UPSTASH credentials are required when CACHE_PROVIDER=upstash");
    }
    this.url = url.endsWith("/") ? url.slice(0, -1) : url;
    this.token = token;
  }

  private async request<T>(command: string, ...args: (string | number)[]) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([command, ...args]),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[upstash] ${command} failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as [T, unknown] | { result?: T; error?: unknown };
    if (Array.isArray(payload)) {
      return payload[0];
    }
    if (payload.error) {
      throw new Error(`[upstash] ${command} error: ${JSON.stringify(payload.error)}`);
    }
    return payload.result as T;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const value = await this.request<string | null>("GET", key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async set(key: string, value: unknown, ttl?: number) {
    const payload = JSON.stringify(value);
    if (ttl) {
      await this.request("SET", key, payload, "EX", ttl);
    } else {
      await this.request("SET", key, payload);
    }
  }

  async delete(key: string) {
    await this.request("DEL", key);
  }
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

type CacheProviderName = "memory" | "redis" | "upstash";

export function createCacheService(providerName: CacheProviderName = "memory") {
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
