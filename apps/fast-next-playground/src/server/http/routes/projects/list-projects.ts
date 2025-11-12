import { createRoute } from "@fast-next/fastify-router";
import type { RouteSchema, TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";

import { listProjects, projectSchema } from "./store";

const schema = {
  response: {
    200: z.object({
      items: z.array(projectSchema),
    }),
  },
} satisfies RouteSchema;

export const listProjectsRoute = createRoute({
  method: "GET",
  path: "/projects",
  resource: "projects",
  operation: "list",
  schema,
  handler: (async () => ({
    items: listProjects(),
  })) satisfies TypedRouteHandler<typeof schema>,
});
