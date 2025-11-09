import type { RouteCallOptions } from "@fast-next/fastify-server-caller";
import type { RouteGenericFromSchema } from "@fast-next/fastify-zod-router";
import type {
  FastifyRouteDefinition,
  OperationsForResource,
  ResourceNames,
  RouteFor,
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

export class FastifyQueryClient<
  TApi extends ResourceClient<any>
> {
  constructor(private readonly api: TApi) {}

  fetchQuery<R extends keyof TApi, O extends keyof TApi[R]>(
    resource: R,
    operation: O,
    options?: QueryOptions<TApi[R][O]>
  ): QueryResult<TApi[R][O]> {
    const resourceBucket = this.api[resource];

    if (!resourceBucket) {
      throw new Error(
        `[fastify-query-client] Resource "${String(resource)}" is not registered`
      );
    }

    const descriptor = resourceBucket[operation] as OperationDescriptor<any>;
    if (!descriptor) {
      throw new Error(
        `[fastify-query-client] Operation "${String(operation)}" is not registered for "${String(resource)}"`
      );
    }

    if ("query" in descriptor) {
      return descriptor.query(options as Parameters<typeof descriptor.query>[0]) as QueryResult<
        TApi[R][O]
      >;
    }

    return descriptor.request(options as Parameters<typeof descriptor.request>[0]) as QueryResult<
      TApi[R][O]
    >;
  }

  fetchMutation<R extends keyof TApi, O extends keyof TApi[R]>(
    resource: R,
    operation: O,
    options?: MutationOptions<TApi[R][O]>
  ): MutationResult<TApi[R][O]> {
    const resourceBucket = this.api[resource];

    if (!resourceBucket) {
      throw new Error(
        `[fastify-query-client] Resource "${String(resource)}" is not registered`
      );
    }

    const descriptor = resourceBucket[operation] as OperationDescriptor<any>;

    if (!descriptor) {
      throw new Error(
        `[fastify-query-client] Operation "${String(operation)}" is not registered for "${String(resource)}"`
      );
    }

    if ("mutate" in descriptor) {
      return descriptor.mutate(options as Parameters<typeof descriptor.mutate>[0]) as MutationResult<
        TApi[R][O]
      >;
    }

    return descriptor.request(options as Parameters<typeof descriptor.request>[0]) as MutationResult<
      TApi[R][O]
    >;
  }

  fetchMany(queries: readonly QueryDescriptor<TApi>[]) {
    return Promise.all(
      queries.map((query) =>
        this.fetchQuery(query.resource, query.operation, query.options)
      )
    );
  }
}

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

type RouteReply<Route extends FastifyRouteDefinition> = RouteGenericFromSchema<
  Route["config"]["schema"]
>["Reply"];

type OperationResponse<Route extends FastifyRouteDefinition> = {
  statusCode: number;
  headers: Record<string, string>;
  data: RouteReply<Route>;
};

type OperationInvoker<Route extends FastifyRouteDefinition> = (
  options?: RouteCallOptions<Route>
) => Promise<OperationResponse<Route>>;

type OperationDescriptor<Route extends FastifyRouteDefinition> =
  Route["method"] extends "GET" | "HEAD"
    ? { query: OperationInvoker<Route>; request: OperationInvoker<Route> }
    : { mutate: OperationInvoker<Route>; request: OperationInvoker<Route> };

type ResourceClient<TRoutes extends readonly FastifyRouteDefinition[]> = {
  [R in ResourceNames<TRoutes>]: {
    [O in OperationsForResource<TRoutes, R>]: OperationDescriptor<
      RouteFor<TRoutes, R, O>
    >;
  };
};

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

export type {
  OperationDescriptor,
  OperationInvoker,
  OperationResponse,
  ResourceClient,
  FastifyCaller,
};
