import {
  buildFastifySchema,
  type HttpMethod,
  type RouteDefinition,
  type RouteMeta,
  type RouteSchema,
  type TypedRouteHandler,
} from "@fast-next/fastify-zod-router";
import type { FastifyInstance } from "fastify";

export type FastifyRouteDefinition<
  TMethod extends HttpMethod = HttpMethod,
  TPath extends string = string,
  TSchema extends RouteSchema = RouteSchema,
  TResource extends string = string,
  TOperation extends string = string,
> = RouteDefinition<TSchema, RouteMeta<TResource, TOperation>> & {
  readonly method: TMethod;
  readonly path: TPath;
  readonly config: {
    readonly schema: TSchema;
    readonly handler: TypedRouteHandler<TSchema>;
    readonly meta: RouteMeta<TResource, TOperation>;
  };
};

export function createRoute<
  const TMethod extends HttpMethod,
  const TPath extends string,
  TSchema extends RouteSchema,
  const TResource extends string,
  const TOperation extends string,
>(config: {
  method: TMethod;
  path: TPath;
  resource: TResource;
  operation: TOperation;
  schema: TSchema;
  handler: TypedRouteHandler<TSchema>;
}): FastifyRouteDefinition<TMethod, TPath, TSchema, TResource, TOperation> {
  return {
    method: config.method,
    path: config.path,
    config: {
      schema: config.schema,
      handler: config.handler,
      meta: {
        resource: config.resource,
        operation: config.operation,
      },
    },
  } as const;
}

export async function registerRoutes(
  app: FastifyInstance,
  routes: readonly FastifyRouteDefinition[],
) {
  for (const route of routes) {
    await app.route({
      method: route.method,
      url: route.path,
      schema: buildFastifySchema(route.config.schema),
      handler: route.config.handler,
    });
  }
}

export type RoutesUnion<TRoutes extends readonly FastifyRouteDefinition[]> = TRoutes[number];

export type ResourceNames<TRoutes extends readonly FastifyRouteDefinition[]> =
  RoutesUnion<TRoutes>["config"]["meta"]["resource"];

export type OperationsForResource<
  TRoutes extends readonly FastifyRouteDefinition[],
  TResource extends ResourceNames<TRoutes>,
> = Extract<
  RoutesUnion<TRoutes>,
  { config: { meta: { resource: TResource } } }
>["config"]["meta"]["operation"];

export type RouteFor<
  TRoutes extends readonly FastifyRouteDefinition[],
  TResource extends ResourceNames<TRoutes>,
  TOperation extends OperationsForResource<TRoutes, TResource>,
> = Extract<
  RoutesUnion<TRoutes>,
  { config: { meta: { resource: TResource; operation: TOperation } } }
>;
