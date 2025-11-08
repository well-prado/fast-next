import { getFastifyApp } from "@fast-next/fastify-app-factory";
import { registerRoutes } from "./routes";

export function getAppInstance() {
  return getFastifyApp({
    configureApp: registerRoutes,
  });
}
