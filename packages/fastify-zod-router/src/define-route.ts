import type { RouteConfig, RouteMeta, RouteSchema } from "./types";

export function defineRoute<
  TSchema extends RouteSchema,
  TMeta extends RouteMeta<string, string>,
  TConfig extends RouteConfig<TSchema, TMeta>,
>(config: TConfig): TConfig {
  return config;
}
