import { createRoute, type FastifyRouteDefinition } from "@fast-next/fastify-router";
import type { TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";
import { mcpServer } from "../../services/mcp/mcp.service";
import "./tools/ping.tool";

const listToolsSchema = {
  response: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
      })
    ),
  }),
} as const;

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
