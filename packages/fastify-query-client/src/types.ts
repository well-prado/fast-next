import type { RouteCallOptions } from "@fast-next/fastify-server-caller";
import type { FastifyRouteDefinition } from "@fast-next/fastify-router";
import type { RouteGenericFromSchema } from "@fast-next/fastify-zod-router";

export type RouteReply<Route extends FastifyRouteDefinition> = RouteGenericFromSchema<
  Route["config"]["schema"]
>["Reply"];

export type OperationResponse<Route extends FastifyRouteDefinition> = {
  statusCode: number;
  headers: Record<string, string>;
  data: RouteReply<Route>;
};

export type OperationInvoker<Route extends FastifyRouteDefinition> = (
  options?: RouteCallOptions<Route>
) => Promise<OperationResponse<Route>>;

export type OperationDescriptor<Route extends FastifyRouteDefinition> =
  Route["method"] extends "GET" | "HEAD"
    ? { query: OperationInvoker<Route>; request: OperationInvoker<Route> }
    : { mutate: OperationInvoker<Route>; request: OperationInvoker<Route> };

export type ResourceClient<
  TRoutes extends readonly FastifyRouteDefinition[]
> = {
  [R in TRoutes[number]["config"]["meta"]["resource"]]: {
    [O in Extract<
      TRoutes[number],
      { config: { meta: { resource: R } } }
    >["config"]["meta"]["operation"]]: OperationDescriptor<
      Extract<
        TRoutes[number],
        { config: { meta: { resource: R; operation: O } } }
      >
    >;
  };
};
