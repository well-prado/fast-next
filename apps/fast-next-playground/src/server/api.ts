import { createServerCaller } from "@fast-next/fastify-server-caller";
import { createServerClient, FastifyQueryClient } from "@fast-next/fastify-server-client";
import type { FastifyCaller } from "@fast-next/fastify-server-client";
import type { FastifyRouteDefinition } from "@fast-next/fastify-router";
import type { BuiltRouter } from "@fast-next/fastify-zod-router";
import { registerHttpRoutes, serverRoutes } from "./http/routes";

const builtRouter = {
  routes: serverRoutes,
  register: registerHttpRoutes,
} satisfies BuiltRouter<typeof serverRoutes>;

export const serverCaller = createServerCaller(builtRouter);
type ServerRoutesLiteral = typeof serverRoutes;
type ServerRoutesDef = ServerRoutesLiteral & readonly FastifyRouteDefinition[];
const typedServerRoutes = serverRoutes as ServerRoutesDef;
const typedServerCaller = serverCaller as unknown as FastifyCaller<ServerRoutesDef>;
export const api = createServerClient(typedServerRoutes, typedServerCaller);
export const queryClient = new FastifyQueryClient();
