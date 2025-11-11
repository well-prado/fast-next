import { Buffer } from "node:buffer";
import type { Auth, BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

export type { Auth, BetterAuthOptions, BetterAuthPlugin };

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

export interface FastNextAuthOptions extends BetterAuthOptions {
  /**
   * Automatically registers the `next-cookies` plugin so cookies flow between
   * Next.js middleware/route handlers and the Better Auth server APIs.
   * Disable if you register the plugin manually.
   */
  includeNextCookies?: boolean;
}

export interface CreateNextAuthHandlerParams {
  auth: Auth;
}

export interface FastifyBetterAuthPluginOptions {
  auth: Auth;
  /**
   * Base path where Better Auth should listen. A wildcard route is registered
   * so `/api/auth/*` works out of the box.
   */
  mountPath?: string;
  /**
   * Whether failures should be logged via Fastify's logger.
   */
  logErrors?: boolean;
}

export type NextRouteHandler = (request: Request) => Promise<Response>;

export interface NextAuthHandlers {
  GET: NextRouteHandler;
  HEAD: NextRouteHandler;
  POST: NextRouteHandler;
  PUT: NextRouteHandler;
  PATCH: NextRouteHandler;
  DELETE: NextRouteHandler;
  OPTIONS: NextRouteHandler;
}

export function createFastNextAuth(options: FastNextAuthOptions): Auth {
  const { includeNextCookies = true, ...rest } = options;
  const basePlugins = Array.isArray(rest.plugins) ? [...rest.plugins] : [];
  const augmentedPlugins = includeNextCookies
    ? appendPluginOnce(basePlugins, nextCookies())
    : basePlugins;

  return betterAuth({
    ...rest,
    plugins: augmentedPlugins,
  } as BetterAuthOptions);
}

export function createNextAuthHandler({ auth }: CreateNextAuthHandlerParams): NextAuthHandlers {
  const handlers = toNextJsHandler(auth);
  const mutate = handlers.POST;
  return {
    GET: handlers.GET,
    HEAD: handlers.GET,
    POST: mutate,
    PUT: mutate,
    PATCH: mutate,
    DELETE: mutate,
    OPTIONS: mutate,
  };
}

export function createFastifyBetterAuthPlugin({
  auth,
  mountPath = "/api/auth",
  logErrors = true,
}: FastifyBetterAuthPluginOptions): FastifyPluginAsync {
  const normalizedBase = normalizeMountPath(mountPath);
  const routes = [normalizedBase, `${normalizedBase}/*`];

  return async function fastNextBetterAuth(app) {
    if (typeof app.decorate === "function") {
      app.decorate("betterAuth", auth);
      if (typeof app.decorateRequest === "function") {
        app.decorateRequest("betterAuth", null);
      }
    }

    app.addHook("onRequest", (request, _reply, done) => {
      request.betterAuth = auth;
      done();
    });

    for (const route of routes) {
      app.all(route, async (request, reply) => {
        try {
          const webRequest = await buildWebRequest(request);
          const response = await auth.handler(webRequest);
          await sendResponse(reply, response);
        } catch (error) {
          if (logErrors) {
            request.log?.error({ err: error }, "[fast-next/better-auth] Failed to proxy request");
          }
          reply.status(500).send({ error: "Better Auth handler failed. Check server logs." });
        }
      });
    }
  };
}

function appendPluginOnce(plugins: BetterAuthPlugin[], candidate: BetterAuthPlugin) {
  if (plugins.some((plugin) => plugin.id === candidate.id)) {
    return plugins;
  }
  return [...plugins, candidate];
}

async function buildWebRequest(request: FastifyRequest): Promise<Request> {
  const origin = resolveOrigin(request);
  const target = request.raw?.url ?? request.url ?? "/";
  const url = new URL(target, origin);
  const headers = buildHeaders(request);
  const body = serializeBody(request);

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  if (body !== undefined) {
    init.body = body;
  }

  return new Request(url, init);
}

function buildHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        headers.append(key, entry);
      });
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

function serializeBody(request: FastifyRequest): BodyInit | undefined {
  const method = request.method?.toUpperCase();
  if (!method || METHODS_WITHOUT_BODY.has(method)) {
    return undefined;
  }

  const body = request.body as unknown;
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return body;
  }

  if (isIterableBuffer(body)) {
    return Buffer.from(body);
  }

  if (body instanceof URLSearchParams) {
    return body;
  }

  if (typeof body === "object") {
    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return buildSearchParams(body as Record<string, unknown>).toString();
    }
    return JSON.stringify(body);
  }

  return undefined;
}

function isIterableBuffer(value: unknown): value is Iterable<number> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.iterator in value &&
    typeof (value as Iterable<unknown>)[Symbol.iterator] === "function"
  );
}

function buildSearchParams(payload: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(payload)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    if (Array.isArray(rawValue)) {
      rawValue.forEach((entry) => {
        params.append(key, String(entry));
      });
      continue;
    }
    params.set(key, String(rawValue));
  }
  return params;
}

async function sendResponse(reply: FastifyReply, response: Response) {
  reply.status(response.status);
  applyResponseHeaders(reply, response);
  if (response.status === 204 || response.body === null) {
    reply.send();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0) {
    reply.send();
    return;
  }

  reply.send(body);
}

function applyResponseHeaders(reply: FastifyReply, response: Response) {
  const setCookies = getSetCookieHeaders(response.headers);
  setCookies.forEach((cookie) => {
    reply.header("set-cookie", cookie);
  });

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie" && setCookies.length) {
      return;
    }
    reply.header(key, value);
  });
}

function getSetCookieHeaders(headers: Headers): string[] {
  const maybe = (
    headers as Headers & {
      getSetCookie?: () => string[];
    }
  ).getSetCookie;

  if (typeof maybe === "function") {
    return maybe.call(headers);
  }

  const header = headers.get("set-cookie");
  if (!header) {
    return [];
  }

  return header
    .split(/,(?=[^;]+=[^;]+)/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveOrigin(request: FastifyRequest): string {
  const protocol =
    request.protocol ??
    (request.headers["x-forwarded-proto"]
      ? String(request.headers["x-forwarded-proto"])
      : request.socket?.encrypted
        ? "https"
        : "http");
  const host = request.headers.host ?? "localhost";
  return `${protocol}://${host}`;
}

function normalizeMountPath(value: string): string {
  if (!value) {
    return "/api/auth";
  }
  const trimmed = value.startsWith("/") ? value : `/${value}`;
  if (trimmed === "/") {
    return "/";
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

declare module "fastify" {
  interface FastifyInstance {
    betterAuth?: Auth;
  }

  interface FastifyRequest {
    betterAuth?: Auth;
  }
}
