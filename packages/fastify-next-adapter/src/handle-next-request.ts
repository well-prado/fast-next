import type { FastifyInstance } from "fastify";
import type { InjectOptions, Response as LightMyRequestResponse } from "light-my-request";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { convertNextHeaders } from "./headers";
import { convertToNextResponse } from "./response";

const METHODS_WITHOUT_BODY = new Set<InjectOptions["method"]>(["GET", "HEAD"]);

export interface FastifyNextAdapterOptions {
  /**
   * Base path that should be stripped before forwarding the request to Fastify.
   * Defaults to `/api`, which matches the conventional Next.js API directory.
   */
  apiBasePath?: string;
}

export async function handleNextRequest(
  req: NextRequest,
  fastifyApp: FastifyInstance,
  options: FastifyNextAdapterOptions = {},
): Promise<NextResponse> {
  try {
    await fastifyApp.ready();
    const headers = convertNextHeaders(req.headers);
    const payload = await getPayload(req);
    const url = new URL(req.url);
    const forwardedPath = getForwardPath(url.pathname, options.apiBasePath);
    const targetUrl = `${forwardedPath}${url.search}`;
    const injectOptions: InjectOptions = {
      method: normalizeMethod(req.method),
      url: targetUrl,
      headers,
      payload,
    };
    const response = (await fastifyApp.inject(injectOptions)) as LightMyRequestResponse;

    return convertToNextResponse(response);
  } catch (error) {
    console.error("[fastify-next-adapter] Failed to handle request:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

function normalizeMethod(method: string): InjectOptions["method"] {
  return method.toUpperCase() as InjectOptions["method"];
}

async function getPayload(req: NextRequest): Promise<Buffer | undefined> {
  const method = normalizeMethod(req.method);
  if (METHODS_WITHOUT_BODY.has(method)) {
    return undefined;
  }

  const arrayBuffer = await req.arrayBuffer();
  if (!arrayBuffer.byteLength) {
    return undefined;
  }

  return Buffer.from(arrayBuffer);
}

function getForwardPath(pathname: string, apiBasePath = "/api"): string {
  if (apiBasePath && pathname.startsWith(apiBasePath)) {
    const stripped = pathname.slice(apiBasePath.length);
    return stripped ? ensureLeadingSlash(stripped) : "/";
  }

  return pathname || "/";
}

function ensureLeadingSlash(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}
