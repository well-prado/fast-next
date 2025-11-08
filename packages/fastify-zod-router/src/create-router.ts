import type { FastifyInstance } from "fastify";
import { buildFastifySchema } from "./json-schema";
import type {
  BuiltRouter,
  RouteConfig,
  RouteDefinition,
  RouteDefinitionWith,
  RouteMeta,
  RouteSchema,
  RouterBuilder,
  RouterRegisterOptions,
} from "./types";

export function createRouter(): RouterBuilder {
  const routes: RouteDefinition[] = [];
  return createRouterBuilder(routes);
}

function createRouterBuilder<
  TRoutes extends readonly RouteDefinition[]
>(registry: RouteDefinition[]): RouterBuilder<TRoutes> {
  const route = <
    TPath extends string,
    TMethod extends RouteDefinition["method"],
    TSchema extends RouteSchema,
    TMeta extends RouteMeta = RouteMeta
  >(
    method: TMethod,
    path: TPath,
    config: RouteConfig<TSchema, TMeta>
  ) => {
    registry.push({
      method,
      path,
      config,
    });

    type NextRoute = RouteDefinitionWith<TMethod, TPath, TSchema, TMeta>;

    return createRouterBuilder<[...TRoutes, NextRoute]>(registry);
  };

  const builder: RouterBuilder<TRoutes> = {
    route,
    get(path, config) {
      return route("GET", path, config);
    },
    post(path, config) {
      return route("POST", path, config);
    },
    put(path, config) {
      return route("PUT", path, config);
    },
    patch(path, config) {
      return route("PATCH", path, config);
    },
    delete(path, config) {
      return route("DELETE", path, config);
    },
    head(path, config) {
      return route("HEAD", path, config);
    },
    options(path, config) {
      return route("OPTIONS", path, config);
    },
    build(): BuiltRouter<TRoutes> {
      return {
        routes: registry as unknown as TRoutes,
        register(app: FastifyInstance, options?: RouterRegisterOptions) {
          registry.forEach((routeDefinition) => {
            const url = options?.prefix
              ? `${options.prefix}${routeDefinition.path}`
              : routeDefinition.path;

            app.route({
              method: routeDefinition.method,
              url,
              schema: buildFastifySchema(routeDefinition.config.schema),
              handler: routeDefinition.config.handler,
            });
          });
        },
      };
    },
  };

  return builder;
}
