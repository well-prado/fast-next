import { createRoute, type FastifyRouteDefinition } from "@fast-next/fastify-router";
import type { RouteSchema, TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";
import { mcpServer } from "../../services/mcp/mcp.service";
import "./tools";

const listToolsSchema = {
  response: {
    200: z.object({
      tools: z.array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
        })
      ),
    }),
  },
} satisfies RouteSchema;

export const McpRoutes = [
  createRoute({
    method: "GET",
    path: "/mcp/tools",
    resource: "mcp",
    operation: "list",
    schema: listToolsSchema,
    handler: (async () => ({ tools: mcpServer.listTools() })) satisfies TypedRouteHandler<typeof listToolsSchema>,
  }),
] as const satisfies readonly FastifyRouteDefinition[];
