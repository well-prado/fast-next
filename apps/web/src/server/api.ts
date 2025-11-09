import { createServerCaller } from "@fast-next/fastify-server-caller";
import {
  createServerClient,
  FastifyQueryClient,
  type FastifyCaller,
} from "@fast-next/fastify-server-client";
import type { BuiltRouter } from "@fast-next/fastify-zod-router";
import { registerRoutes, serverRoutes } from "./routes";

const builtRouter = {
  routes: serverRoutes,
  register: registerRoutes,
} satisfies BuiltRouter<typeof serverRoutes>;

export const serverCaller = createServerCaller(builtRouter);
const serverClientCaller = ((
  method,
  path,
  options
) => serverCaller(method as any, path as any, options as any)) as FastifyCaller<
  typeof serverRoutes
>;

export const api = createServerClient(serverRoutes, serverClientCaller);
export const queryClient = new FastifyQueryClient(api);
