import { createServerCaller } from "@fast-next/fastify-server-caller";
import { createServerClient, FastifyQueryClient } from "@fast-next/fastify-server-client";
import type { BuiltRouter } from "@fast-next/fastify-zod-router";
import { registerRoutes, serverRoutes } from "./routes";

const builtRouter = {
  routes: serverRoutes,
  register: registerRoutes,
} satisfies BuiltRouter<typeof serverRoutes>;

export const serverCaller = createServerCaller(builtRouter);
export const api = createServerClient(serverRoutes, serverCaller);
export const queryClient = new FastifyQueryClient();
