import { createServerCaller, type RouteCallOptions } from "@fast-next/fastify-server-caller";
import type { BuiltRouter, RouteGenericFromSchema } from "@fast-next/fastify-zod-router";
import { registerRoutes, serverRoutes } from "./routes";

const builtRouter = {
  routes: serverRoutes,
  register: registerRoutes,
} satisfies BuiltRouter<typeof serverRoutes>;

export const serverCaller = createServerCaller(builtRouter);

export const api = createFastifyServerClient(serverRoutes, serverCaller);

type ServerRoute = (typeof serverRoutes)[number];
type ServerRoutes = typeof serverRoutes;

function createFastifyServerClient<TRoutes extends readonly ServerRoute[]>(
  routes: TRoutes,
  caller: typeof serverCaller
): ResourceClientFromRoutes<TRoutes> {
  const client: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const resource = route.config.meta.resource;
    const operation = route.config.meta.operation;

    if (!client[resource]) {
      client[resource] = {};
    }

    client[resource]![operation] = createOperationDescriptor(route, caller);
  }

  return client as ResourceClientFromRoutes<TRoutes>;
}

function createOperationDescriptor<Route extends ServerRoute>(
  route: Route,
  caller: typeof serverCaller
): OperationDescriptor<Route> {
  const invoke: OperationInvoker<Route> = async (options) => {
    const response = await caller(route.method, route.path, options as RouteCallOptions<Route>);

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

type RoutesUnion<TRoutes extends readonly ServerRoute[]> = TRoutes[number];

type ResourceNames<TRoutes extends readonly ServerRoute[]> =
  RoutesUnion<TRoutes>["config"]["meta"]["resource"];

type OperationsForResource<
  TRoutes extends readonly ServerRoute[],
  TResource extends ResourceNames<TRoutes>
> = Extract<
  RoutesUnion<TRoutes>,
  { config: { meta: { resource: TResource } } }
>["config"]["meta"]["operation"];

type RouteFor<
  TRoutes extends readonly ServerRoute[],
  TResource extends ResourceNames<TRoutes>,
  TOperation extends OperationsForResource<TRoutes, TResource>
> = Extract<
  RoutesUnion<TRoutes>,
  { config: { meta: { resource: TResource; operation: TOperation } } }
>;

type RouteReply<Route extends ServerRoute> = RouteGenericFromSchema<
  Route["config"]["schema"]
>["Reply"];

type OperationResponse<Route extends ServerRoute> = {
  statusCode: number;
  headers: Record<string, string>;
  data: RouteReply<Route>;
};

type OperationInvoker<Route extends ServerRoute> = (
  options?: RouteCallOptions<Route>
) => Promise<OperationResponse<Route>>;

type OperationDescriptor<Route extends ServerRoute> = Route["method"] extends "GET" | "HEAD"
  ? { query: OperationInvoker<Route>; request: OperationInvoker<Route> }
  : { mutate: OperationInvoker<Route>; request: OperationInvoker<Route> };

type ResourceClientFromRoutes<TRoutes extends readonly ServerRoute[]> = {
  [R in ResourceNames<TRoutes>]: {
    [O in OperationsForResource<TRoutes, R>]: OperationDescriptor<
      RouteFor<TRoutes, R, O>
    >;
  };
};
