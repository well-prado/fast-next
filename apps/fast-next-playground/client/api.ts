"use client";

import { createBrowserClient } from "@fast-next/fastify-browser-client";
import { FastifyQueryClient } from "@fast-next/fastify-query-client";
import { serverRoutes } from "@/server/http/routes";

const clientQueryCache = new FastifyQueryClient();

export const api = createBrowserClient(serverRoutes, {
  baseUrl: "/api",
  queryClient: clientQueryCache,
});
