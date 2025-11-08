import type { BuiltRouter, RouteDefinition, RouteGenericFromSchema, RouteSchema } from "@fast-next/fastify-zod-router";
import type { FastifyReply, FastifyRequest } from "fastify";

type RoutesOf<TRouter extends BuiltRouter> = TRouter["routes"][number];

type SchemaOfRoute<TDef extends RouteDefinition> = TDef extends RouteDefinition<
  infer TSchema
>
  ? TSchema
  : RouteSchema;

type RequestPayload<TSchema extends RouteSchema> = {
  body?: RouteGenericFromSchema<TSchema>["Body"];
  params?: RouteGenericFromSchema<TSchema>["Params"];
  query?: RouteGenericFromSchema<TSchema>["Querystring"];
  headers?: RouteGenericFromSchema<TSchema>["Headers"];
};

export type RouteCallOptions<TDef extends RouteDefinition> =
  RequestPayload<SchemaOfRoute<TDef>> & {
    context?: Record<string, unknown>;
  };

export type RouteCallResult<TDef extends RouteDefinition> = {
  statusCode: number;
  headers: Record<string, string>;
  body: RouteGenericFromSchema<SchemaOfRoute<TDef>>["Reply"];
};

type RouterMethod<TRouter extends BuiltRouter> = RoutesOf<TRouter>["method"];

type RouterPath<
  TRouter extends BuiltRouter,
  TMethod extends RouterMethod<TRouter>
> = Extract<RoutesOf<TRouter>, { method: TMethod }>["path"];

type RouteMatch<
  TRouter extends BuiltRouter,
  TMethod extends RouterMethod<TRouter>,
  TPath extends RouterPath<TRouter, TMethod>
> = Extract<RoutesOf<TRouter>, { method: TMethod; path: TPath }>;

export type ServerCaller<TRouter extends BuiltRouter> = <
  TMethod extends RouterMethod<TRouter>,
  TPath extends RouterPath<TRouter, TMethod>
>(
  method: TMethod,
  path: TPath,
  options?: RouteCallOptions<RouteMatch<TRouter, TMethod, TPath>>
) => Promise<RouteCallResult<RouteMatch<TRouter, TMethod, TPath>>>;

const ROUTE_KEY_SEPARATOR = "::";

export function createServerCaller<TRouter extends BuiltRouter>(
  router: TRouter
): ServerCaller<TRouter> {
  const routeMap = new Map<string, RouteDefinition>();

  router.routes.forEach((route) => {
    const key = buildRouteKey(route.method, route.path);
    routeMap.set(key, route);
  });

  const caller: ServerCaller<TRouter> = (async (
    method,
    path,
    options
  ) => {
    const routeKey = buildRouteKey(method, path);
    const route = routeMap.get(routeKey);

    if (!route) {
      throw new Error(
        `[fastify-server-caller] Route not found: ${method} ${path}`
      );
    }

    return executeRoute(route, method, path, options);
  }) as ServerCaller<TRouter>;

  return caller;
}

async function executeRoute<TDef extends RouteDefinition>(
  route: TDef,
  method: string,
  path: string,
  options?: RouteCallOptions<TDef>
): Promise<RouteCallResult<TDef>> {
  const schema = route.config.schema as SchemaOfRoute<TDef>;
  const request = createRequestStub(schema, method, path, options);
  const replyShim = createReplyStub();

  const handlerResult = await route.config.handler(
    request,
    replyShim.reply as FastifyReply
  );

  const { statusCode, headers, payload, sent } = replyShim.collect();
  const body = sent ? payload : handlerResult;

  return {
    statusCode,
    headers,
    body: body as RouteCallResult<TDef>["body"],
  };
}

function createRequestStub<TSchema extends RouteSchema>(
  _schema: TSchema,
  method: string,
  path: string,
  options?: RequestPayload<TSchema> & { context?: Record<string, unknown> }
): FastifyRequest<RouteGenericFromSchema<TSchema>> {
  const request: Record<string, unknown> = {
    method,
    url: path,
    params: options?.params ?? {},
    query: options?.query ?? {},
    body: options?.body,
    headers: options?.headers ?? {},
    log: silentLogger,
  };

  if (options?.context) {
    request.context = options.context;
  }

  return request as unknown as FastifyRequest<RouteGenericFromSchema<TSchema>>;
}

function createReplyStub() {
  let statusCode = 200;
  const headers = new Map<string, string>();
  let payload: unknown;
  let sent = false;

  const reply = {
    code(value: number) {
      statusCode = value;
      return this;
    },
    status(value: number) {
      return this.code(value);
    },
    header(key: string, value: string) {
      headers.set(key.toLowerCase(), value);
      return this;
    },
    type(value: string) {
      headers.set("content-type", value);
      return this;
    },
    send(value: unknown) {
      payload = value;
      sent = true;
      return this;
    },
    get headers() {
      return Object.fromEntries(headers.entries());
    },
  };

  return {
    reply: reply as unknown as FastifyReply,
    collect: () => ({
      statusCode,
      headers: Object.fromEntries(headers.entries()),
      payload,
      sent,
    }),
  };
}

function buildRouteKey(method: string, path: string) {
  return `${method.toUpperCase()}${ROUTE_KEY_SEPARATOR}${path}`;
}

const silentLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => silentLogger,
};
