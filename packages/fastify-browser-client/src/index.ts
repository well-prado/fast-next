"use client";

import {
  type CacheEntry,
  createQueryKey,
  FastifyQueryClient,
  type OperationDescriptor,
  type OperationResponse,
  parseQueryKey,
  type QueryKeyFilter,
  type QueryStatus,
  type RouteReply,
} from "@fast-next/fastify-query-client";
import type {
  FastifyRouteDefinition,
  OperationsForResource,
  ResourceNames,
  RouteFor,
} from "@fast-next/fastify-router";
import type { RouteCallOptions } from "@fast-next/fastify-server-caller";
import type { HttpMethod } from "@fast-next/fastify-zod-router";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface BrowserClientOptions {
  baseUrl?: string;
  credentials?: RequestCredentials;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
  queryClient?: FastifyQueryClient;
}

export function createBrowserClient<
  TRoutes extends readonly FastifyRouteDefinition<HttpMethod, string, any, string, string>[],
>(
  routes: TRoutes,
  options: BrowserClientOptions = {},
): BrowserClient<TRoutes> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? "/api");
  const fetchImpl = resolveFetch(options.fetch);
  const queryClient = options.queryClient ?? new FastifyQueryClient();
  const client: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const resource = route.config.meta.resource;
    const operation = route.config.meta.operation;

    const descriptor = createOperationDescriptor(route, {
      baseUrl,
      credentials: options.credentials,
      defaultHeaders: options.defaultHeaders,
      fetchImpl,
    });

    let bucket = client[resource];
    if (!bucket) {
      bucket = {};
      client[resource] = bucket;
    }
    bucket[operation] = attachHooks(descriptor, {
      operation,
      resource,
      route,
      queryClient,
    });
  }

  return client as BrowserClient<TRoutes>;
}

function attachHooks<Route extends FastifyRouteDefinition>(
  descriptor: OperationDescriptor<Route>,
  context: DescriptorContext<Route>,
): BrowserOperationDescriptor<Route> {
  if (isQueryDescriptor(descriptor)) {
    return {
      ...descriptor,
      useQuery: <TSelected = OperationResponse<Route>>(
        options?: UseQueryOptions<Route, TSelected>,
      ) => useRouteQuery(descriptor, context, options),
    } as unknown as BrowserOperationDescriptor<Route>;
  }

  if (!isMutationDescriptor(descriptor)) {
    throw new Error(
      "[fastify-browser-client] Attempted to attach mutation hooks to a query descriptor",
    );
  }

  return {
    ...descriptor,
    useMutation: (options?: UseMutationOptions<Route>) =>
      useRouteMutation(descriptor, context, options),
  } as unknown as BrowserOperationDescriptor<Route>;
}

function createOperationDescriptor<Route extends FastifyRouteDefinition>(
  route: Route,
  transport: TransportOptions,
): OperationDescriptor<Route> {
  const invoke: OperationInvoker<Route> = async (options) => {
    const response = await transport.fetchImpl(
      buildUrl(
        transport.baseUrl,
        route.path,
        normalizeRecord(options?.params),
        normalizeRecord(options?.query),
      ),
      buildRequestInit(route.method, options, transport),
    );

    const payload = await toOperationResponse<Route>(response);

    if (!response.ok) {
      throw new FastifyClientError(`Request failed with status ${response.status}`, payload);
    }

    return payload;
  };

  if (route.method === "GET" || route.method === "HEAD") {
    return {
      query: invoke,
      request: invoke,
    } as OperationDescriptor<Route>;
  }

  return {
    mutate: invoke,
    request: invoke,
  } as OperationDescriptor<Route>;
}

function useRouteQuery<Route extends FastifyRouteDefinition, TSelected = OperationResponse<Route>>(
  descriptor: OperationDescriptor<Route> & { query: OperationInvoker<Route> },
  context: DescriptorContext<Route>,
  options?: UseQueryOptions<Route, TSelected>,
): UseQueryResult<Route, TSelected> {
  const {
    enabled = true,
    staleTime = 0,
    refetchOnWindowFocus = false,
    select,
    initialData,
    queryKey: providedKey,
    onError,
    onSuccess,
    ...requestOptions
  } = options ?? {};

  const requestSignature = useStableSignature(requestOptions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable options should only change when signature changes
  const stableRequestOptions = useMemo(() => requestOptions, [requestSignature]);
  const key =
    providedKey ??
    createQueryKey({
      resource: context.resource,
      operation: context.operation,
      method: context.route.method,
      params: stableRequestOptions.params,
      query: stableRequestOptions.query,
      body: stableRequestOptions.body,
      extra: requestSignature,
    });

  const [state, setState] = useState<CacheEntry<OperationResponse<Route>>>(() => {
    const cached = context.queryClient.getState<OperationResponse<Route>>(key);
    if (cached) return cached;
    if (initialData) {
      return { status: "success", data: initialData, updatedAt: Date.now() };
    }
    return { status: enabled ? "loading" : "idle" };
  });

  useEffect(() => {
    if (!initialData) return;
    const cached = context.queryClient.getState<OperationResponse<Route>>(key);
    if (!cached) {
      context.queryClient.setQueryData(key, initialData);
      setState({ status: "success", data: initialData, updatedAt: Date.now() });
    }
  }, [initialData, key, context.queryClient]);

  useEffect(() => {
    return context.queryClient.subscribe(key, () => {
      const entry =
        context.queryClient.getState<OperationResponse<Route>>(key) ??
        ({ status: "idle" } as CacheEntry<OperationResponse<Route>>);
      setState(entry);
    });
  }, [context.queryClient, key]);

  const execute = useCallback(() => {
    return context.queryClient
      .fetchQuery(key, () => descriptor.query(stableRequestOptions), { staleTime })
      .then((response) => {
        onSuccess?.(response);
        return response;
      })
      .catch((error) => {
        onError?.(error);
        throw error;
      });
  }, [context.queryClient, descriptor, key, onError, onSuccess, stableRequestOptions, staleTime]);

  useEffect(() => {
    if (!enabled) return;
    execute();
  }, [enabled, execute]);

  useEffect(() => {
    if (!enabled) return;
    if (state.status === "idle") {
      execute();
    }
  }, [enabled, state.status, execute]);

  useEffect(() => {
    if (!refetchOnWindowFocus || typeof window === "undefined") {
      return undefined;
    }
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      execute();
    };
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [execute, refetchOnWindowFocus]);

  const response = state.data;
  const selectedData = select && response ? select(response) : (response as TSelected | undefined);
  const status = state.status;

  return {
    data: selectedData,
    response,
    error: state.error,
    status,
    refetch: execute,
    isIdle: status === "idle",
    isLoading: status === "loading" && enabled,
    isFetching: status === "loading",
    isSuccess: status === "success",
    isError: status === "error",
  };
}

function useRouteMutation<Route extends FastifyRouteDefinition>(
  descriptor: OperationDescriptor<Route> & { mutate: OperationInvoker<Route> },
  context: DescriptorContext<Route>,
  options?: UseMutationOptions<Route>,
): UseMutationResult<Route> {
  const [state, setState] = useState<MutationState<Route>>({ status: "idle" });
  const invalidateTargets = options?.invalidate;

  const mutateAsync = useCallback(
    async (variables?: RouteCallOptions<Route>) => {
      setState({ status: "loading" });
      try {
        const response = await descriptor.mutate(variables);
        setState({ status: "success", data: response });
        await options?.onSuccess?.(response, variables);
        runInvalidations(context.queryClient, invalidateTargets);
        return response;
      } catch (error) {
        setState({ status: "error", error });
        await options?.onError?.(error, variables);
        throw error;
      }
    },
    [descriptor, invalidateTargets, context.queryClient, options],
  );

  const mutate = useCallback(
    (variables?: RouteCallOptions<Route>) => {
      void mutateAsync(variables);
    },
    [mutateAsync],
  );

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return {
    ...state,
    mutate,
    mutateAsync,
    reset,
    isIdle: state.status === "idle",
    isPending: state.status === "loading",
    isSuccess: state.status === "success",
    isError: state.status === "error",
  };
}

function runInvalidations(
  queryClient: FastifyQueryClient,
  targets?: QueryKeyFilter | QueryKeyFilter[],
) {
  if (!targets) return;
  const list = Array.isArray(targets) ? targets : [targets];
  for (const target of list) {
    queryClient.invalidateQueries(target);
  }
}

function buildRequestInit<Route extends FastifyRouteDefinition>(
  method: HttpMethod,
  options: RouteCallOptions<Route> | undefined,
  transport: TransportOptions,
): RequestInit {
  const headers = {
    ...(transport.defaultHeaders ?? {}),
    ...(options?.headers ? normalizeHeaders(options.headers) : {}),
  };

  const init: RequestInit = {
    method,
    headers,
    credentials: transport.credentials,
  };

  if (!METHODS_WITH_BODY.has(method)) {
    return init;
  }

  if (options?.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    init.body = JSON.stringify(options.body);
  }

  return init;
}

function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, unknown>,
  query?: Record<string, unknown>,
): string {
  const withParams = applyPathParams(path, params);
  const queryString = buildQueryString(query);
  return `${baseUrl}${withParams}${queryString}`;
}

function applyPathParams(path: string, params?: Record<string, unknown>) {
  if (!params) return ensureStartsWithSlash(path);
  return ensureStartsWithSlash(path).replace(/:([A-Za-z0-9_]+)/g, (match, key) => {
    const value = params[key];
    if (value === undefined) return match;
    return encodeURIComponent(String(value));
  });
}

function buildQueryString(query?: Record<string, unknown>) {
  if (!query) return "";
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        params.append(key, String(item));
      });
    } else {
      params.append(key, String(value));
    }
  });
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function ensureStartsWithSlash(input: string) {
  return input.startsWith("/") ? input : `/${input}`;
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

async function toOperationResponse<Route extends FastifyRouteDefinition>(
  response: Response,
): Promise<OperationResponse<Route>> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let data: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    data = await safeJson(response);
  } else {
    const text = await response.text();
    data = text.length ? text : null;
  }

  return {
    statusCode: response.status,
    headers,
    data: data as RouteReply<Route>,
  };
}

async function safeJson(response: Response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function normalizeBaseUrl(baseUrl: string) {
  if (!baseUrl) return "";
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizeHeaders(value: Record<string, unknown>) {
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, val]) => {
    if (val === undefined || val === null) return acc;
    acc[key] = String(val);
    return acc;
  }, {});
}

function useStableSignature(value: unknown) {
  return useMemo(() => JSON.stringify(stableSerialize(value)), [value]);
}

function stableSerialize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableSerialize(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a > b ? 1 : -1));
    return entries.reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = stableSerialize(val);
      return acc;
    }, {});
  }
  return value;
}

const METHODS_WITH_BODY = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

class FastifyClientError<
  Route extends FastifyRouteDefinition = FastifyRouteDefinition,
> extends Error {
  constructor(
    message: string,
    public readonly response: OperationResponse<Route>,
  ) {
    super(message);
    this.name = "FastifyClientError";
  }
}

interface TransportOptions {
  baseUrl: string;
  credentials?: RequestCredentials;
  defaultHeaders?: Record<string, string>;
  fetchImpl: typeof fetch;
}

function resolveFetch(provided?: typeof fetch): typeof fetch {
  const candidate = provided ?? globalThis.fetch;
  if (typeof candidate !== "function") {
    throw new Error(
      "[fastify-browser-client] A fetch implementation is required in this environment",
    );
  }

  if (provided) {
    return provided;
  }

  return candidate.bind(globalThis);
}

interface DescriptorContext<Route extends FastifyRouteDefinition> {
  route: Route;
  resource: string;
  operation: string;
  queryClient: FastifyQueryClient;
}

interface MutationState<Route extends FastifyRouteDefinition> {
  status: QueryStatus;
  data?: OperationResponse<Route>;
  error?: unknown;
}

type OperationInvoker<Route extends FastifyRouteDefinition> = (
  options?: RouteCallOptions<Route>,
) => Promise<OperationResponse<Route>>;

function isQueryDescriptor<Route extends FastifyRouteDefinition>(
  descriptor: OperationDescriptor<Route>,
): descriptor is OperationDescriptor<Route> & {
  query: OperationInvoker<Route>;
} {
  return typeof (descriptor as { query?: unknown }).query === "function";
}

function isMutationDescriptor<Route extends FastifyRouteDefinition>(
  descriptor: OperationDescriptor<Route>,
): descriptor is OperationDescriptor<Route> & {
  mutate: OperationInvoker<Route>;
} {
  return typeof (descriptor as { mutate?: unknown }).mutate === "function";
}

export interface UseQueryOptions<
  Route extends FastifyRouteDefinition,
  TSelected = OperationResponse<Route>,
> extends RouteCallOptions<Route> {
  enabled?: boolean;
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
  select?: (response: OperationResponse<Route>) => TSelected;
  initialData?: OperationResponse<Route>;
  queryKey?: string;
  onSuccess?: (response: OperationResponse<Route>) => void;
  onError?: (error: unknown) => void;
}

export interface UseQueryResult<
  Route extends FastifyRouteDefinition,
  TSelected = OperationResponse<Route>,
> {
  data: TSelected | undefined;
  response: OperationResponse<Route> | undefined;
  error: unknown;
  status: QueryStatus;
  refetch: () => Promise<OperationResponse<Route>>;
  isIdle: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
}

export interface UseMutationOptions<Route extends FastifyRouteDefinition> {
  invalidate?: QueryKeyFilter | QueryKeyFilter[];
  onSuccess?: (
    response: OperationResponse<Route>,
    variables?: RouteCallOptions<Route>,
  ) => void | Promise<void>;
  onError?: (error: unknown, variables?: RouteCallOptions<Route>) => void | Promise<void>;
}

export interface UseMutationResult<Route extends FastifyRouteDefinition> {
  status: QueryStatus;
  data?: OperationResponse<Route>;
  error?: unknown;
  mutate: (variables?: RouteCallOptions<Route>) => void;
  mutateAsync: (variables?: RouteCallOptions<Route>) => Promise<OperationResponse<Route>>;
  reset: () => void;
  isIdle: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
}

type BrowserOperationDescriptor<Route extends FastifyRouteDefinition> = Route["method"] extends
  | "GET"
  | "HEAD"
  ? OperationDescriptor<Route> & {
      useQuery: <TSelected = OperationResponse<Route>>(
        options?: UseQueryOptions<Route, TSelected>,
      ) => UseQueryResult<Route, TSelected>;
    }
  : OperationDescriptor<Route> & {
      useMutation: (options?: UseMutationOptions<Route>) => UseMutationResult<Route>;
    };

type BrowserClient<TRoutes extends readonly FastifyRouteDefinition[]> = {
  [R in ResourceNames<TRoutes>]: {
    [O in OperationsForResource<TRoutes, R>]: BrowserOperationDescriptor<RouteFor<TRoutes, R, O>>;
  };
};

export type { BrowserClient, BrowserOperationDescriptor, OperationResponse, RouteReply };
export { FastifyClientError, FastifyQueryClient, createQueryKey, parseQueryKey };
