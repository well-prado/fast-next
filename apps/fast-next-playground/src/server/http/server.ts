import fastifyCors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";

import { registerHttpRoutes } from "./routes";
import { errorHandler } from "./error-handler";

export async function registerHttpServer(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  await app.register(fastifyCors);
  await registerHttpRoutes(app);
}
