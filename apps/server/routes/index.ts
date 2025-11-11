import type { FastifyInstance } from "fastify";
import { createRoute, registerRoutes as registerFastifyRoutes, type FastifyRouteDefinition } from "@fast-next/fastify-router";
import type { TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";
import { McpRoutes } from "./features/mcp/routes";
// FAST_NEXT_ROUTE_IMPORTS

const healthSchema = {
  response: z.object({
    status: z.literal("ok"),
  }),
} as const;

export const serverRoutes = [
  createRoute({
    method: "GET",
    path: "/health",
    resource: "system",
    operation: "health",
    schema: healthSchema,
    handler: (async () => ({ status: "ok" as const })) satisfies TypedRouteHandler<typeof healthSchema>,
  }),
    ...McpRoutes,
  // FAST_NEXT_ROUTE_SPREAD
] as const satisfies readonly FastifyRouteDefinition[];

export async function registerRoutes(app: FastifyInstance) {
  await registerFastifyRoutes(app, serverRoutes);
}

export type ServerRoutes = typeof serverRoutes;
