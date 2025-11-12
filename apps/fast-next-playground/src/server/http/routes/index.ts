import type { FastifyInstance } from "fastify";
import {
  registerRoutes as registerFastifyRoutes,
  type FastifyRouteDefinition,
} from "@fast-next/fastify-router";

import { systemRoutes } from "./system";
import { projectRoutes } from "./projects";
// FAST_NEXT_ROUTE_IMPORTS
import { McpRoutes } from "../../features/mcp/routes";

export const serverRoutes = [
  ...systemRoutes,
  ...projectRoutes,
  ...McpRoutes,
  // FAST_NEXT_ROUTE_SPREAD
] as const satisfies readonly FastifyRouteDefinition[];

export type ServerRoutes = typeof serverRoutes;
export type ServerRoute = ServerRoutes[number];
export type { Project } from "./projects/store";

export async function registerHttpRoutes(app: FastifyInstance) {
  await registerFastifyRoutes(app, serverRoutes);
}
