import type { FastifyInstance, FastifyReply, FastifyRequest, RouteGenericInterface } from "fastify";
import type { ZodTypeAny, infer as ZodInfer } from "zod";

export type AnyZod = ZodTypeAny;

export type RouteResponseSchema =
  | AnyZod
  | Partial<Record<number | `${number}` | `${1 | 2 | 3 | 4 | 5}xx`, AnyZod>>;

export interface RouteSchema {
  body?: AnyZod;
  query?: AnyZod;
  querystring?: AnyZod;
  params?: AnyZod;
  headers?: AnyZod;
  response?: RouteResponseSchema;
}

type InferOrUnknown<T extends AnyZod | undefined> = T extends AnyZod ? ZodInfer<T> : any;

type ResponseUnion<
  TSchema extends RouteSchema,
  TResponse = TSchema["response"],
> = TResponse extends AnyZod
  ? ZodInfer<TResponse>
  : TResponse extends Record<string | number, AnyZod>
    ? {
        [K in keyof TResponse]: TResponse[K] extends AnyZod ? ZodInfer<TResponse[K]> : never;
      }[keyof TResponse]
    : any;

export type RouteGenericFromSchema<TSchema extends RouteSchema> = RouteGenericInterface & {
  Body: InferOrUnknown<TSchema["body"]>;
  Querystring: InferOrUnknown<TSchema["query"] | TSchema["querystring"]>;
  Params: InferOrUnknown<TSchema["params"]>;
  Headers: InferOrUnknown<TSchema["headers"]>;
  Reply: ResponseUnion<TSchema>;
};

export type TypedRouteHandler<TSchema extends RouteSchema> = (
  request: FastifyRequest<RouteGenericFromSchema<TSchema>>,
  reply: FastifyReply,
) => Promise<unknown> | unknown;

type BivariantRouteHandler<TSchema extends RouteSchema> = {
  bivarianceHack: TypedRouteHandler<TSchema>;
}["bivarianceHack"];

export interface RouteMeta<TResource extends string = string, TOperation extends string = string> {
  resource: TResource;
  operation: TOperation;
}

export interface RouteConfig<TSchema extends RouteSchema, TMeta extends RouteMeta = RouteMeta> {
  schema: TSchema;
  handler: BivariantRouteHandler<TSchema>;
  meta: TMeta;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface RouteDefinition<
  TSchema extends RouteSchema = RouteSchema,
  TMeta extends RouteMeta = RouteMeta,
> {
  method: HttpMethod;
  path: string;
  config: RouteConfig<TSchema, TMeta>;
}

export type RouteDefinitionWith<
  TMethod extends HttpMethod,
  TPath extends string,
  TSchema extends RouteSchema,
  TMeta extends RouteMeta = RouteMeta,
> = RouteDefinition<TSchema, TMeta> & {
  method: TMethod;
  path: TPath;
};

export interface RouterRegisterOptions {
  prefix?: string;
}

export interface BuiltRouter<
  TRoutes extends readonly RouteDefinition<any, any>[] = readonly RouteDefinition<any, any>[],
> {
  routes: TRoutes;
  register: (app: FastifyInstance, options?: RouterRegisterOptions) => Promise<void> | void;
}

export interface RouterBuilder<
  TRoutes extends readonly RouteDefinition<any, any>[] = readonly [],
> {
  route<TPath extends string, TMethod extends HttpMethod, TSchema extends RouteSchema>(
    method: TMethod,
    path: TPath,
    config: RouteConfig<TSchema>,
  ): RouterBuilder<[...TRoutes, RouteDefinitionWith<TMethod, TPath, RouteSchema>]>;
  get<TPath extends string, TSchema extends RouteSchema>(
    path: TPath,
    config: RouteConfig<TSchema>,
  ): RouterBuilder<[...TRoutes, RouteDefinitionWith<"GET", TPath, RouteSchema>]>;
  post<TPath extends string, TSchema extends RouteSchema>(
    path: TPath,
    config: RouteConfig<TSchema>,
  ): RouterBuilder<[...TRoutes, RouteDefinitionWith<"POST", TPath, RouteSchema>]>;
  put<TPath extends string, TSchema extends RouteSchema>(
    path: TPath,
    config: RouteConfig<TSchema>,
  ): RouterBuilder<[...TRoutes, RouteDefinitionWith<"PUT", TPath, RouteSchema>]>;
  patch<TPath extends string, TSchema extends RouteSchema>(
    path: TPath,
    config: RouteConfig<TSchema>,
  ): RouterBuilder<[...TRoutes, RouteDefinitionWith<"PATCH", TPath, RouteSchema>]>;
  delete<TPath extends string, TSchema extends RouteSchema>(
    path: TPath,
    config: RouteConfig<TSchema>,
  ): RouterBuilder<[...TRoutes, RouteDefinitionWith<"DELETE", TPath, RouteSchema>]>;
  head<TPath extends string, TSchema extends RouteSchema>(
    path: TPath,
    config: RouteConfig<TSchema>,
  ): RouterBuilder<[...TRoutes, RouteDefinitionWith<"HEAD", TPath, RouteSchema>]>;
  options<TPath extends string, TSchema extends RouteSchema>(
    path: TPath,
    config: RouteConfig<TSchema>,
  ): RouterBuilder<[...TRoutes, RouteDefinitionWith<"OPTIONS", TPath, RouteSchema>]>;
  build(): BuiltRouter<TRoutes>;
}
