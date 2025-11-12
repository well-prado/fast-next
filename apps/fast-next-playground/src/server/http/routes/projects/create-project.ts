import { createRoute } from "@fast-next/fastify-router";
import type { RouteSchema, TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";

import { addProject, projectSchema } from "./store";

const schema = {
  body: z.object({
    name: z.string().min(3),
    status: projectSchema.shape.status.optional().default("draft"),
  }),
  response: {
    201: projectSchema,
  },
} satisfies RouteSchema;

export const createProjectRoute = createRoute({
  method: "POST",
  path: "/projects",
  resource: "projects",
  operation: "create",
  schema,
  handler: (async (request, reply) => {
    const newProject = addProject({
      id: `p${Date.now().toString().slice(-4)}`,
      name: request.body.name,
      status: request.body.status ?? "draft",
    });

    reply.code(201);
    return newProject;
  }) satisfies TypedRouteHandler<typeof schema>,
});
