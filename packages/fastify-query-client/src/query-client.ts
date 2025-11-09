import type { OperationDescriptor } from "./types";

export type QueryStatus = "idle" | "loading" | "success" | "error";

export interface CacheEntry<TData = unknown> {
  status: QueryStatus;
  data?: TData;
  error?: unknown;
  updatedAt?: number;
  promise?: Promise<TData>;
}

export interface FetchQueryOptions {
  staleTime?: number;
}

export type QueryKeyFilter =
  | string
  | RegExp
  | QueryKeyPredicate
  | Partial<Pick<QueryKeyInput, "resource" | "operation" | "method">>;

type QueryKeyPredicate = (key: string) => boolean;

export interface QueryKeyInput {
  resource: string;
  operation: string;
  method: string;
  params?: unknown;
  query?: unknown;
  body?: unknown;
  extra?: unknown;
}

export function createQueryKey(input: QueryKeyInput): string {
  return JSON.stringify(serialize(input));
}

export function parseQueryKey(key: string): QueryKeyInput | null {
  try {
    const value = JSON.parse(key);
    if (value && typeof value === "object") {
      return value as QueryKeyInput;
    }
    return null;
  } catch {
    return null;
  }
}

export class FastifyQueryClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly listeners = new Map<string, Set<() => void>>();

  getState<TData = unknown>(key: string): CacheEntry<TData> | undefined {
    return this.cache.get(key) as CacheEntry<TData> | undefined;
  }

  getQueryData<TData = unknown>(key: string): TData | undefined {
    return this.cache.get(key)?.data as TData | undefined;
  }

  setQueryData<TData = unknown>(
    key: string,
    data: TData,
    status: QueryStatus = "success"
  ) {
    const entry: CacheEntry<TData> = {
      status,
      data,
      updatedAt: Date.now(),
    };
    this.cache.set(key, entry);
    this.notify(key);
  }

  subscribe(key: string, listener: () => void): () => void {
    const set = this.listeners.get(key) ?? new Set();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (!set.size) {
        this.listeners.delete(key);
      }
    };
  }

  async fetchQuery<TData = unknown>(
    key: string,
    fetcher: () => Promise<TData>,
    options: FetchQueryOptions = {}
  ): Promise<TData> {
    const existing = this.cache.get(key) as CacheEntry<TData> | undefined;
    const now = Date.now();

    if (
      existing &&
      existing.status === "success" &&
      options.staleTime &&
      existing.updatedAt &&
      now - existing.updatedAt < options.staleTime
    ) {
      return existing.data as TData;
    }

    if (existing?.promise) {
      return existing.promise;
    }

    const promise = fetcher();

    this.cache.set(key, {
      status: "loading",
      data: existing?.data,
      updatedAt: existing?.updatedAt,
      promise,
    });
    this.notify(key);

    try {
      const data = await promise;
      this.cache.set(key, {
        status: "success",
        data,
        updatedAt: Date.now(),
      });
      this.notify(key);
      return data;
    } catch (error) {
      this.cache.set(key, {
        status: "error",
        data: existing?.data,
        error,
        updatedAt: Date.now(),
      });
      this.notify(key);
      throw error;
    }
  }

  fetchMany(descriptors: {
    key: string;
    fetcher: () => Promise<unknown>;
    options?: FetchQueryOptions;
  }[]) {
    return Promise.all(
      descriptors.map((descriptor) =>
        this.fetchQuery(descriptor.key, descriptor.fetcher, descriptor.options)
      )
    );
  }

  invalidateQueries(filter?: QueryKeyFilter) {
    this.matchingKeys(filter).forEach((key) => {
      this.cache.delete(key);
      this.notify(key);
    });
  }

  removeQueries(filter?: QueryKeyFilter) {
    this.invalidateQueries(filter);
  }

  clear() {
    this.cache.clear();
    this.listeners.clear();
  }

  private notify(key: string) {
    const listeners = this.listeners.get(key);
    if (!listeners) return;
    listeners.forEach((listener) => listener());
  }

  private matchingKeys(filter?: QueryKeyFilter): string[] {
    const keys = Array.from(this.cache.keys());
    if (!filter) {
      return keys;
    }

    if (typeof filter === "string") {
      return keys.filter((key) => key === filter);
    }

    if (filter instanceof RegExp) {
      return keys.filter((key) => filter.test(key));
    }

    if (typeof filter === "function") {
      return keys.filter((key) => filter(key));
    }

    return keys.filter((key) => {
      const parsed = parseQueryKey(key);
      if (!parsed) return false;
      if (filter.resource && parsed.resource !== filter.resource) {
        return false;
      }
      if (filter.operation && parsed.operation !== filter.operation) {
        return false;
      }
      if (filter.method && parsed.method !== filter.method) {
        return false;
      }
      return true;
    });
  }
}

function serialize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => serialize(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a > b ? 1 : -1));

    return entries.reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = serialize(val);
      return acc;
    }, {});
  }

  return value;
}
