import Fastify from "fastify";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyServerOptions,
} from "fastify";

type AcceptablePlugin = FastifyPluginAsync | FastifyPluginCallback;

type ConfigureAppHook = (app: FastifyInstance) => Promise<void> | void;

export interface FastifyAppConfig extends FastifyServerOptions {
  plugins?: AcceptablePlugin[];
  configureApp?: ConfigureAppHook;
}

type FastifyGlobal = typeof globalThis & {
  __FAST_NEXT_FASTIFY_APP__?: FastifyInstance | null;
};

const globalFastify = globalThis as FastifyGlobal;

let instance: FastifyInstance | null =
  globalFastify.__FAST_NEXT_FASTIFY_APP__ ?? null;
let instancePromise: Promise<FastifyInstance> | null = null;

export async function getFastifyApp(
  config?: FastifyAppConfig
): Promise<FastifyInstance> {
  if (instance) {
    return instance;
  }

  if (!instancePromise) {
    instancePromise = buildFastifyApp(config);
  }

  instance = await instancePromise;

  if (process.env.NODE_ENV === "development") {
    globalFastify.__FAST_NEXT_FASTIFY_APP__ = instance;
  }

  return instance;
}

async function buildFastifyApp(
  config?: FastifyAppConfig
): Promise<FastifyInstance> {
  const {
    plugins = [],
    configureApp,
    logger,
    ...restOptions
  } = config ?? {};

  const resolvedLogger =
    logger ?? (process.env.NODE_ENV === "development" ? true : false);

  const app = Fastify({
    ...restOptions,
    logger: resolvedLogger,
  });

  for (const plugin of plugins) {
    await app.register(plugin as FastifyPluginCallback);
  }

  if (configureApp) {
    await configureApp(app);
  }

  return app;
}

export async function resetFastifyApp(): Promise<void> {
  if (!instance) {
    instancePromise = null;
    globalFastify.__FAST_NEXT_FASTIFY_APP__ = null;
    return;
  }

  await instance.close();
  instance = null;
  instancePromise = null;
  globalFastify.__FAST_NEXT_FASTIFY_APP__ = null;
}

export function getFastifyAppSync(): FastifyInstance | null {
  return instance;
}
