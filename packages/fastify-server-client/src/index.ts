import type { RouteCallOptions } from "@fast-next/fastify-server-caller";
import type { FastifyRouteDefinition, RouteFor } from "@fast-next/fastify-router";
import {
  FastifyQueryClient,
  type OperationDescriptor,
  type OperationInvoker,
  type OperationResponse,
  type ResourceClient,
  type RouteReply,
} from "@fast-next/fastify-query-client";
import type {
  OperationsForResource,
  ResourceNames,
} from "@fast-next/fastify-router";

export function createServerClient<
  TRoutes extends readonly FastifyRouteDefinition[]
>(
  routes: TRoutes,
  caller: FastifyCaller<TRoutes>
): ResourceClient<TRoutes> {
  const client: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const resource = route.config.meta.resource;
    const operation = route.config.meta.operation;

    const resourceBucket = client[resource] ?? (client[resource] = {});
    resourceBucket[operation] = createOperationDescriptor(route, caller);
  }

  return client as ResourceClient<TRoutes>;
}

export { FastifyQueryClient } from "@fast-next/fastify-query-client";

function createOperationDescriptor<
  TRoutes extends readonly FastifyRouteDefinition[],
  Route extends TRoutes[number]
>(
  route: Route,
  caller: FastifyCaller<TRoutes>
): OperationDescriptor<Route> {
  const invoke: OperationInvoker<Route> = async (options) => {
    const response = await caller(
      route.method,
      route.path,
      options
    );

    return {
      statusCode: response.statusCode,
      headers: response.headers,
      data: response.body as RouteReply<Route>,
    };
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

// ---------- Types ----------

type RouteUnion<TRoutes extends readonly FastifyRouteDefinition[]> =
  TRoutes[number];

type MethodNames<TRoutes extends readonly FastifyRouteDefinition[]> =
  RouteUnion<TRoutes>["method"];

type PathsForMethod<
  TRoutes extends readonly FastifyRouteDefinition[],
  TMethod extends MethodNames<TRoutes>
> = Extract<RouteUnion<TRoutes>, { method: TMethod }>["path"];

type RouteMatch<
  TRoutes extends readonly FastifyRouteDefinition[],
  TMethod extends MethodNames<TRoutes>,
  TPath extends PathsForMethod<TRoutes, TMethod>
> = Extract<RouteUnion<TRoutes>, { method: TMethod; path: TPath }>;

type FastifyCaller<TRoutes extends readonly FastifyRouteDefinition[]> = <
  TMethod extends MethodNames<TRoutes>,
  TPath extends PathsForMethod<TRoutes, TMethod>
>(
  method: TMethod,
  path: TPath,
  options?: RouteCallOptions<RouteMatch<TRoutes, TMethod, TPath>>
) => Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: RouteReply<RouteMatch<TRoutes, TMethod, TPath>>;
}>;

export type QueryOptions<Descriptor> = Descriptor extends {
  query: (options?: infer Options) => unknown;
}
  ? Options
  : Descriptor extends { request: (options?: infer RequestOptions) => unknown }
    ? RequestOptions
    : never;

export type QueryResult<Descriptor> = Descriptor extends {
  query: (...args: any[]) => infer Result;
}
  ? Result
  : Descriptor extends { request: (...args: any[]) => infer RequestResult }
    ? RequestResult
    : never;

export type MutationOptions<Descriptor> = Descriptor extends {
  mutate: (options?: infer Options) => unknown;
}
  ? Options
  : Descriptor extends { request: (options?: infer RequestOptions) => unknown }
    ? RequestOptions
    : never;

export type MutationResult<Descriptor> = Descriptor extends {
  mutate: (...args: any[]) => infer Result;
}
  ? Result
  : Descriptor extends { request: (...args: any[]) => infer RequestResult }
    ? RequestResult
    : never;

export type QueryDescriptor<TApi extends ResourceClient<any>> = {
  [R in keyof TApi]: {
    [O in keyof TApi[R]]: {
      resource: R;
      operation: O;
      options?: QueryOptions<TApi[R][O]>;
    };
  }[keyof TApi[R]];
}[keyof TApi];

export type { FastifyCaller };
export type {
  OperationDescriptor,
  OperationInvoker,
  OperationResponse,
  ResourceClient,
} from "@fast-next/fastify-query-client";
