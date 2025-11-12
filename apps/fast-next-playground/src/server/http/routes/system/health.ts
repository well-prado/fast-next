import { createRoute } from "@fast-next/fastify-router";
import type { RouteSchema, TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";

const schema = {
  response: {
    200: z.object({
      status: z.literal("ok"),
    }),
  },
} satisfies RouteSchema;

export const systemHealthRoute = createRoute({
  method: "GET",
  path: "/health",
  resource: "system",
  operation: "health",
  schema,
  handler: (async () => ({ status: "ok" as const })) satisfies TypedRouteHandler<typeof schema>,
});
