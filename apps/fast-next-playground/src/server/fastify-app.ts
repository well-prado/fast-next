import { getFastifyApp } from "@fast-next/fastify-app-factory";
import { registerHttpServer } from "./http/server";
import { createFastifyBetterAuthPlugin } from "@fast-next/better-auth";
import { auth } from "./services/auth/better-auth";

export function getAppInstance() {
  return getFastifyApp({
    plugins: [createFastifyBetterAuthPlugin({ auth })],
    configureApp: registerHttpServer,
  });
}
