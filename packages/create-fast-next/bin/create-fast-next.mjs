#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";

const HELP = `create-fast-next

Usage:
  create-fast-next init [projectDir] [options]
  create-fast-next feature <name> [options]
  create-fast-next queue <start|status|generate> [options]
  create-fast-next cache <clear|stats> [options]
  create-fast-next mcp <start|status|tool> [options]

Options:
  --app <path>       Relative path to the Next.js app directory (default: app)
  --server <path>    Relative path to the server folder (default: src/server)
  --api <path>       Relative path to the API catch-all folder (default: <app>/api/[...fastify])
  --install <pm>     Install dependencies with pnpm|npm|yarn|bun|auto|skip (default: prompt in TTY)
  --with-queue       Include BullMQ queue scaffolding
  --with-cache <provider> Include cache service (memory|redis|upstash)
  --with-mcp         Include MCP server scaffolding
  --with-docker      Include docker-compose template
  --force            Overwrite existing files when scaffolding
  --dir <path>       Base directory for feature scaffolding (default: .)
  --yes              Skip interactive prompts
  -h, --help         Show this message
`;

const CORE_DEPENDENCIES = [
  "fastify",
  "zod",
  "@fast-next/fastify-app-factory",
  "@fast-next/fastify-next-adapter",
  "@fast-next/fastify-router",
  "@fast-next/fastify-zod-router",
  "@fast-next/fastify-server-caller",
  "@fast-next/fastify-server-client",
  "@fast-next/fastify-browser-client",
  "@fast-next/fastify-query-client",
];

const QUEUE_DEPENDENCIES = ["bullmq", "ioredis"];
const CACHE_DEPENDENCIES = {
  memory: [],
  redis: ["ioredis"],
  upstash: ["@upstash/redis"],
};
const MCP_DEPENDENCIES = ["@modelcontextprotocol/sdk"];

const INSTALL_COMMANDS = {
  pnpm: {
    bin: "pnpm",
    buildArgs: (deps) => ["add", ...deps],
  },
  npm: {
    bin: "npm",
    buildArgs: (deps) => ["install", ...deps],
  },
  yarn: {
    bin: "yarn",
    buildArgs: (deps) => ["add", ...deps],
  },
  bun: {
    bin: "bun",
    buildArgs: (deps) => ["add", ...deps],
  },
};

async function main() {
  const [, , rawCommand, ...rest] = process.argv;
  if (!rawCommand || rawCommand === "-h" || rawCommand === "--help") {
    console.log(HELP);
    return;
  }

  const args = parseArgs(rest);
  try {
    if (rawCommand === "init") {
      await runInit(args);
    } else if (rawCommand === "feature") {
      await runFeature(args);
    } else if (rawCommand === "queue") {
      await runQueueCommand(args);
    } else if (rawCommand === "cache") {
      await runCacheCommand(args);
    } else if (rawCommand === "mcp") {
      await runMcpCommand(args);
    } else {
      console.error(`Unknown command: ${rawCommand}\n`);
      console.log(HELP);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("\n[create-fast-next]", error.message ?? error);
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith("--")) {
      const [rawKey, inlineValue] = token.slice(2).split("=");
      const key = rawKey;
      if (inlineValue !== undefined) {
        result[key] = inlineValue;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        result[key] = args[i + 1];
        i += 1;
      } else {
        result[key] = true;
      }
    } else if (token.startsWith("-")) {
      if (token === "-h") {
        result.help = true;
      }
    } else {
      result._.push(token);
    }
  }
  return result;
}

async function runInit(options) {
  const prompter = createPrompter(process.stdin.isTTY && !options.yes);
  const projectDirInput = options._[0] ?? (await prompter.ask("Project directory", "."));
  const projectRoot = path.resolve(process.cwd(), projectDirInput);
  const appDir = options.app ?? (await prompter.ask("Next.js app directory", "app"));
  const serverDir = options.server ?? (await prompter.ask("Server directory", path.join("src", "server")));
  const apiDir = options.api ?? (await prompter.ask("API catch-all path", path.join(appDir, "api", "[...fastify]")));
  const force = Boolean(options.force);
  const queueEnabled = await resolveBooleanOption(
    options["with-queue"],
    prompter,
    "Add BullMQ queue scaffolding?",
    false
  );
  const cacheOption = await resolveCacheOption(options["with-cache"], prompter);
  const mcpEnabled = await resolveBooleanOption(
    options["with-mcp"],
    prompter,
    "Add MCP server scaffolding?",
    false
  );
  const dockerEnabled = await resolveBooleanOption(
    options["with-docker"],
    prompter,
    "Add docker-compose template?",
    false
  );
  const installChoice = await resolveInstallChoice(options.install, prompter, projectRoot);
  prompter.close();

  const routeFile = path.join(projectRoot, apiDir, "route.ts");
  const serverDirAbs = path.join(projectRoot, serverDir);
  const fastifyAppFile = path.join(serverDirAbs, "fastify-app.ts");
  const routesFile = path.join(serverDirAbs, "routes", "index.ts");
  const apiHelperFile = path.join(serverDirAbs, "api.ts");
  const featuresDir = path.join(serverDirAbs, "features");

  await ensureDir(path.dirname(routeFile));
  await ensureDir(path.dirname(fastifyAppFile));
  await ensureDir(path.dirname(routesFile));
  await ensureDir(featuresDir);

  const relativeImportToFastifyApp = toImportPath(
    path.relative(path.dirname(routeFile), fastifyAppFile)
  );

  await writeFile(routeFile, getRouteHandlerTemplate(relativeImportToFastifyApp), force);
  await writeFile(fastifyAppFile, getFastifyAppTemplate(), force);
  await writeFile(routesFile, getRoutesIndexTemplate(), force);
  await writeFile(apiHelperFile, getServerApiTemplate(), force);
  await writeFile(path.join(featuresDir, ".gitkeep"), "", false);

  const dependencySet = new Set(CORE_DEPENDENCIES);
  const postInitNotes = [];

  if (queueEnabled) {
    await scaffoldQueueTemplate({ projectRoot, serverDirAbs, force });
    QUEUE_DEPENDENCIES.forEach((dep) => dependencySet.add(dep));
    const workersEntry = path.relative(projectRoot, path.join(serverDirAbs, "workers", "index.ts"));
    postInitNotes.push(
      "Configure REDIS_HOST/REDIS_PORT/REDIS_PASSWORD in your environment before running queues.",
      `Start workers with ts-node/tsx (e.g., 'pnpm exec tsx ${workersEntry}') in a separate process.`
    );
  }

  if (cacheOption.enabled) {
    await scaffoldCacheTemplate({ projectRoot, serverDirAbs, force, provider: cacheOption.provider });
    const deps = CACHE_DEPENDENCIES[cacheOption.provider] ?? [];
    deps.forEach((dep) => dependencySet.add(dep));
    postInitNotes.push(
      `Cache provider '${cacheOption.provider}' scaffolded. Configure env vars (see src/server/services/cache/cache.service.ts).`
    );
  }

  if (mcpEnabled) {
    await scaffoldMcpTemplate({ projectRoot, serverDirAbs, force });
    MCP_DEPENDENCIES.forEach((dep) => dependencySet.add(dep));
    postInitNotes.push("MCP server files created under services/mcp. Start it with 'pnpm exec tsx src/server/services/mcp/server.ts'.");
  }

  if (dockerEnabled) {
    await scaffoldDockerTemplate({ projectRoot, force });
    postInitNotes.push("docker-compose.yml generated. Update .env before running 'docker compose up'.");
  }

  if (installChoice && installChoice !== "skip") {
    await ensurePackageJsonDeps(projectRoot, Array.from(dependencySet));
    await installDependencies(installChoice, projectRoot, Array.from(dependencySet));
  } else {
    console.log("\nDependencies to install:");
    console.log("  " + Array.from(dependencySet).join(" "));
    console.log("Use your preferred package manager (e.g. 'pnpm add ...').");
  }

  console.log("\nNext steps:\n");
  console.log("1. Ensure your tsconfig.json maps '@/*' to your source directory if you plan to use alias imports.");
  console.log("2. Start Next.js with 'pnpm dev' and hit /api/health to verify the bridge.");
  if (postInitNotes.length) {
    console.log("\nAdditional notes:");
    postInitNotes.forEach((note) => console.log(`- ${note}`));
  }
}

async function runFeature(options) {
  if (!options._[0]) {
    throw new Error("feature name is required: create-fast-next feature <name>");
  }
  const featureName = options._[0];
  const projectRoot = path.resolve(process.cwd(), options.dir ?? ".");
  const serverDir = options.server ?? path.join("src", "server");
  const serverDirAbs = path.join(projectRoot, serverDir);
  const featuresDir = path.join(serverDirAbs, "features");
  const featureDir = path.join(featuresDir, featureName);
  const routesFile = path.join(serverDirAbs, "routes", "index.ts");
  const routesFilePath = path.join(featureDir, "routes.ts");
  const schemaFile = path.join(featureDir, "schemas.ts");
  const serviceFile = path.join(featureDir, "service.ts");
  const testFile = path.join(featureDir, "routes.test.ts");

  await ensureDir(featureDir);
  await writeFile(schemaFile, getFeatureSchemaTemplate(featureName), Boolean(options.force));
  await writeFile(serviceFile, getFeatureServiceTemplate(featureName), Boolean(options.force));
  await writeFile(routesFilePath, getFeatureRoutesTemplate(featureName), Boolean(options.force));
  await writeFile(testFile, getFeatureTestTemplate(featureName), false);
  await injectFeatureImport(routesFile, featureName);
  console.log(`Feature '${featureName}' scaffolded (schemas, service, routes, test).`);
}

async function runQueueCommand(options) {
  const action = options._[0] ?? "start";
  const projectRoot = path.resolve(process.cwd(), options.dir ?? ".");
  const entry = options.entry ?? path.join("src", "server", "workers", "index.ts");
  const entryAbs = path.join(projectRoot, entry);
  const packageManager = detectPackageManager(projectRoot) ?? "pnpm";
  const serverDir = options.server ?? path.join("src", "server");
  const redisUrl = options.redis ?? process.env.REDIS_URL ?? undefined;

  if (action === "start") {
    const runner = getPackageRunner(packageManager, ["exec", "tsx", entryAbs]);
    console.log(`Starting queue workers via ${packageManager} (${entry})...`);
    await spawnInteractive(runner.bin, runner.args, projectRoot);
  } else if (action === "status") {
    await printQueueStats({ redisUrl, projectRoot, serverDir });
  } else if (action === "generate") {
    if (!options._[1]) {
      throw new Error("Queue name required: create-fast-next queue generate <name>");
    }
    await scaffoldCustomQueue({ projectRoot, name: options._[1], serverDir, force: Boolean(options.force) });
  } else {
    throw new Error(`Unknown queue action '${action}'. Use 'start', 'status', or 'generate'.`);
  }
}

async function runCacheCommand(options) {
  const action = options._[0];
  if (!action) {
    throw new Error("cache command requires an action: clear|stats");
  }
  const client = await createRedisClient(options.redis);
  if (!client) {
    console.error("Redis client unavailable. Set REDIS_HOST/PORT or pass --redis.");
    return;
  }

  if (action === "clear") {
    const key = options._[1];
    if (!key) {
      throw new Error("cache clear requires a key argument");
    }
    await client.del(key);
    console.log(`Deleted cache key '${key}'.`);
  } else if (action === "stats") {
    const size = await client.dbsize();
    const info = await client.info("memory");
    console.log(`Cache entries: ${size}`);
    console.log(info);
  } else {
    throw new Error(`Unknown cache action '${action}'. Use 'clear' or 'stats'.`);
  }

  await client.quit();
}

async function runMcpCommand(options) {
  const action = options._[0];
  if (!action) {
    throw new Error("mcp command requires an action: start|status|tool");
  }
  const projectRoot = path.resolve(process.cwd(), options.dir ?? ".");
  const entry = options.entry ?? path.join("src", "server", "services", "mcp", "server.ts");
  const entryAbs = path.join(projectRoot, entry);
  const packageManager = detectPackageManager(projectRoot) ?? "pnpm";
  const toolsDir = path.join(projectRoot, options.tools ?? path.join("src", "server", "features", "mcp", "tools"));
  const indexPath = path.join(toolsDir, "index.ts");

  if (action === "start") {
    const runner = getPackageRunner(packageManager, ["exec", "tsx", entryAbs]);
    console.log(`Starting MCP server via ${packageManager} (${entry})...`);
    await spawnInteractive(runner.bin, runner.args, projectRoot);
  } else if (action === "status") {
    await listMcpTools(indexPath);
  } else if (action === "tool") {
    const name = options._[1];
    if (!name) {
      throw new Error("mcp tool command requires a tool name");
    }
    await scaffoldMcpTool({ toolsDir, indexPath, name, force: Boolean(options.force) });
  } else {
    throw new Error(`Unknown mcp action '${action}'. Use 'start', 'status', or 'tool <name>'.`);
  }
}

async function writeFile(filePath, content, force) {
  const exists = await fileExists(filePath);
  if (exists && !force) {
    console.log(`[skip] ${path.relative(process.cwd(), filePath)} (already exists)`);
    return;
  }
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
  console.log(`${exists ? "[update]" : "[create]"} ${path.relative(process.cwd(), filePath)}`);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toImportPath(relativePath) {
  let normalized = relativePath.replace(/\\/g, "/");
  if (!normalized.startsWith(".")) {
    normalized = `./${normalized}`;
  }
  return normalized.replace(/\.tsx?$/, "");
}

function getRouteHandlerTemplate(importPath) {
  return `import type { NextRequest } from "next/server";
import { handleNextRequest } from "@fast-next/fastify-next-adapter";
import { getAppInstance } from "${importPath}";

async function handle(req: NextRequest) {
  const app = await getAppInstance();
  return handleNextRequest(req, app);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
`;
}

function getFastifyAppTemplate() {
  return `import { getFastifyApp } from "@fast-next/fastify-app-factory";
import { registerRoutes } from "./routes";

export function getAppInstance() {
  return getFastifyApp({
    configureApp: registerRoutes,
  });
}
`;
}

function getRoutesIndexTemplate() {
  return `import type { FastifyInstance } from "fastify";
import { createRoute, registerRoutes as registerFastifyRoutes, type FastifyRouteDefinition } from "@fast-next/fastify-router";
import type { TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";
// FAST_NEXT_ROUTE_IMPORTS

const healthSchema = {
  response: z.object({
    status: z.literal("ok"),
  }),
} as const;

export const serverRoutes = [
  createRoute({
    method: "GET",
    path: "/health",
    resource: "system",
    operation: "health",
    schema: healthSchema,
    handler: (async () => ({ status: "ok" as const })) satisfies TypedRouteHandler<typeof healthSchema>,
  }),
  // FAST_NEXT_ROUTE_SPREAD
] as const satisfies readonly FastifyRouteDefinition[];

export async function registerRoutes(app: FastifyInstance) {
  await registerFastifyRoutes(app, serverRoutes);
}

export type ServerRoutes = typeof serverRoutes;
`;
}

function getServerApiTemplate() {
  return `import { createServerCaller } from "@fast-next/fastify-server-caller";
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
`;
}

function getFeatureSchemaTemplate(name) {
  const camel = camelCase(name);
  const pascal = toPascalCase(name);
  return `import { z } from "zod";

export const ${camel}Schema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "archived"]),
});

export const list${pascal}Schema = {
  response: z.object({
    items: z.array(${camel}Schema),
  }),
} as const;

export const create${pascal}Schema = {
  body: z.object({
    name: z.string().min(3),
    status: ${camel}Schema.shape.status.optional().default("draft"),
  }),
  response: {
    201: ${camel}Schema,
  },
} as const;
`;
}

function getFeatureServiceTemplate(name) {
  const pascal = toPascalCase(name);
  const camel = camelCase(name);
  return `import type { z } from "zod";
import { ${camel}Schema } from "./schemas";

type ${pascal} = z.infer<typeof ${camel}Schema>;

const data: ${pascal}[] = [
  { id: "${camel}-1", name: "Sample ${pascal} A", status: "draft" },
  { id: "${camel}-2", name: "Sample ${pascal} B", status: "active" },
];

export async function list${pascal}() {
  return { items: data };
}

export async function create${pascal}(input: Pick<${pascal}, "name" | "status">) {
  const next: ${pascal} = {
    id: `${camel}-\${Date.now()}`,
    name: input.name,
    status: input.status ?? "draft",
  };
  data.push(next);
  return next;
}
`;
}

function getFeatureRoutesTemplate(name) {
  const pascal = toPascalCase(name);
  const exportName = `${pascal}Routes`;
  const resource = dashCase(name);
  return `import { createRoute, type FastifyRouteDefinition } from "@fast-next/fastify-router";
import type { TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { list${pascal}Schema, create${pascal}Schema } from "./schemas";
import { list${pascal}, create${pascal} } from "./service";

export const ${exportName} = [
  createRoute({
    method: "GET",
    path: "/${resource}",
    resource: "${resource}",
    operation: "list",
    schema: list${pascal}Schema,
    handler: (async () => list${pascal}()) satisfies TypedRouteHandler<typeof list${pascal}Schema>,
  }),
  createRoute({
    method: "POST",
    path: "/${resource}",
    resource: "${resource}",
    operation: "create",
    schema: create${pascal}Schema,
    handler: (async (request, reply) => {
      const created = await create${pascal}(request.body);
      reply.code(201);
      return created;
    }) satisfies TypedRouteHandler<typeof create${pascal}Schema>,
  }),
] as const satisfies readonly FastifyRouteDefinition[];
`;
}

function getFeatureTestTemplate(name) {
  const resource = dashCase(name);
  const pascal = toPascalCase(name);
  return `// Example Vitest suite for the ${resource} feature.
// Delete or adapt based on your testing stack.
// import { describe, it, expect } from "vitest";
// import { api } from "@/server/api";

// describe("${pascal} routes", () => {
//   it("lists ${resource}", async () => {
//     const result = await api.${resource}.list.query();
//     expect(result.statusCode).toBe(200);
//   });
// });
`;
}

async function injectFeatureImport(routesFile, featureName) {
  const exists = await fileExists(routesFile);
  if (!exists) {
    throw new Error(`Routes file not found: ${routesFile}`);
  }
  const content = await fs.readFile(routesFile, "utf8");
  const importMarker = "// FAST_NEXT_ROUTE_IMPORTS";
  const spreadMarker = "// FAST_NEXT_ROUTE_SPREAD";
  if (!content.includes(importMarker) || !content.includes(spreadMarker)) {
    throw new Error("Routes file is missing FAST_NEXT markers. Re-run init or add them manually.");
  }
  const pascal = toPascalCase(featureName);
  const exportName = `${pascal}Routes`;
  const relativeImport = `./features/${featureName}/routes`;
  const importSnippet = `import { ${exportName} } from "${relativeImport}";\n${importMarker}`;
  const spreadSnippet = `  ...${exportName},\n  ${spreadMarker}`;
  const nextContent = content
    .replace(importMarker, importSnippet)
    .replace(spreadMarker, spreadSnippet);
  await fs.writeFile(routesFile, nextContent, "utf8");
  console.log(`[update] ${path.relative(process.cwd(), routesFile)} (feature linked)`);
}

function toPascalCase(value) {
  return value
    .split(/[^a-zA-Z0-9]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function dashCase(value) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function camelCase(value) {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function createPrompter(enabled) {
  if (!enabled) {
    return {
      enabled: false,
      async ask(_question, defaultValue) {
        return defaultValue;
      },
      close() {},
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    enabled: true,
    async ask(question, defaultValue) {
      const suffix = defaultValue ? ` (${defaultValue})` : "";
      const answer = await rl.question(`${question}${suffix}: `);
      const trimmed = answer.trim();
      return trimmed || defaultValue;
    },
    close() {
      rl.close();
    },
  };
}

async function resolveInstallChoice(value, prompter, projectRoot) {
  if (value) {
    if (value === true) return "skip";
    const normalizedValue = typeof value === "string" ? value.toLowerCase() : value;
    if (normalizedValue === "auto") {
      return detectPackageManager(projectRoot) ?? "skip";
    }
    if (["pnpm", "npm", "yarn", "bun", "skip"].includes(normalizedValue)) {
      return normalizedValue;
    }
    return "skip";
  }

  if (!prompter.enabled) {
    return "skip";
  }

  const answer = await prompter.ask(
    "Install dependencies now? (pnpm/npm/yarn/bun/skip)",
    detectPackageManager(projectRoot) ?? "skip"
  );
  const normalized = answer.trim().toLowerCase();
  if (["pnpm", "npm", "yarn", "bun"].includes(normalized)) {
    return normalized;
  }
  return "skip";
}

async function resolveBooleanOption(value, prompter, question, defaultValue) {
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value.toLowerCase() === "yes";
  }
  if (typeof value === "boolean") {
    return value;
  }

  if (!prompter.enabled) {
    return defaultValue;
  }

  const defaultLabel = defaultValue ? "Y/n" : "y/N";
  const answer = await prompter.ask(`${question} ${defaultLabel}`, defaultValue ? "y" : "n");
  return /^y(es)?$/i.test(answer.trim());
}

async function resolveCacheOption(value, prompter) {
  const valid = ["memory", "redis", "upstash", "none", "false"];
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "false" || normalized === "none") {
      return { enabled: false, provider: "memory" };
    }
    if (valid.includes(normalized)) {
      if (normalized === "none") {
        return { enabled: false, provider: "memory" };
      }
      return { enabled: true, provider: normalized };
    }
  } else if (typeof value === "boolean") {
    return { enabled: value, provider: "memory" };
  }

  if (!prompter.enabled) {
    return { enabled: false, provider: "memory" };
  }

  const answer = await prompter.ask(
    "Add cache service? (memory/redis/upstash/none)",
    "none"
  );
  const normalized = answer.trim().toLowerCase();
  if (normalized === "none" || normalized === "no" || normalized === "n") {
    return { enabled: false, provider: "memory" };
  }
  if (normalized === "redis" || normalized === "upstash" || normalized === "memory") {
    return { enabled: true, provider: normalized };
  }
  return { enabled: false, provider: "memory" };
}

function detectPackageManager(projectRoot) {
  const checks = [
    { file: "pnpm-lock.yaml", manager: "pnpm" },
    { file: "package-lock.json", manager: "npm" },
    { file: "yarn.lock", manager: "yarn" },
    { file: "bun.lockb", manager: "bun" },
  ];
  for (const entry of checks) {
    if (fsSyncExists(path.join(projectRoot, entry.file))) {
      return entry.manager;
    }
  }
  return null;
}

function fsSyncExists(filePath) {
  try {
    fsSync.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensurePackageJsonDeps(projectRoot, deps) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    console.warn(
      `[warn] package.json not found at ${packageJsonPath}. Skipping dependency injection.`
    );
    return;
  }
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  pkg.dependencies = pkg.dependencies ?? {};
  let changed = false;
  deps.forEach((dep) => {
    if (!pkg.dependencies[dep]) {
      pkg.dependencies[dep] = "latest";
      changed = true;
    }
  });
  if (changed) {
    await fs.writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    console.log(`[update] package.json (added ${deps.length} deps)`);
  }
}

async function ensurePackageJsonScripts(projectRoot, scripts) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return;
  }
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  pkg.scripts = pkg.scripts ?? {};
  let changed = false;
  for (const [key, value] of Object.entries(scripts)) {
    if (!pkg.scripts[key]) {
      pkg.scripts[key] = value;
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    console.log(`[update] package.json (added docker scripts)`);
  }
}

async function installDependencies(manager, cwd, deps) {
  const config = INSTALL_COMMANDS[manager];
  if (!config) {
    console.warn(`[warn] Unsupported package manager '${manager}', skipping install.`);
    return;
  }
  console.log(`\nInstalling dependencies with ${manager}...\n`);
  await spawnInteractive(config.bin, config.buildArgs(deps), cwd);
}

async function scaffoldQueueTemplate({ projectRoot, serverDirAbs, force }) {
  const servicesDir = path.join(serverDirAbs, "services");
  const queuesDir = path.join(serverDirAbs, "queues");
  const workersDir = path.join(serverDirAbs, "workers");

  await ensureDir(servicesDir);
  await ensureDir(queuesDir);
  await ensureDir(workersDir);

  await writeFile(
    path.join(servicesDir, "queue.service.ts"),
    getQueueServiceTemplate(),
    force
  );

  await writeFile(
    path.join(queuesDir, "email.queue.ts"),
    getQueueExampleTemplate(),
    force
  );

  await writeFile(
    path.join(workersDir, "email.worker.ts"),
    getQueueWorkerTemplate(),
    force
  );

  await writeFile(
    path.join(workersDir, "index.ts"),
    getQueueWorkerIndexTemplate(),
    force
  );

  console.log("[queue] BullMQ scaffolding created");
}

async function scaffoldCacheTemplate({ serverDirAbs, force, provider }) {
  const cacheDir = path.join(serverDirAbs, "services", "cache");
  await ensureDir(cacheDir);
  const filePath = path.join(cacheDir, "cache.service.ts");
  await writeFile(filePath, getCacheServiceTemplate(provider), force);
  console.log(`[cache] ${provider} cache service created`);
}

async function scaffoldCustomQueue({ projectRoot, name, serverDir, force }) {
  const serverDirAbs = path.join(projectRoot, serverDir);
  const queuesDir = path.join(serverDirAbs, "queues");
  const workersDir = path.join(serverDirAbs, "workers");
  await ensureDir(queuesDir);
  await ensureDir(workersDir);
  const queueFile = path.join(queuesDir, `${name}.queue.ts`);
  const workerFile = path.join(workersDir, `${name}.worker.ts`);
  await writeFile(queueFile, getCustomQueueTemplate(name), force);
  await writeFile(workerFile, getCustomWorkerTemplate(name), force);
  console.log(`[queue] custom queue '${name}' scaffolded`);
}

async function printQueueStats({ redisUrl, projectRoot, serverDir }) {
  try {
    const { Queue } = await import("bullmq");
    const IORedis = (await import("ioredis")).default;
    const connection = redisUrl ? new IORedis(redisUrl) : new IORedis({
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    });

    const queuesDir = path.join(projectRoot, serverDir, "queues");
    const queueNames = await listQueuesFromDir(queuesDir);
    if (!queueNames.length) {
      console.log(`No queues found in ${queuesDir}.`);
      return;
    }

    console.log("Queue status:\n");
    for (const name of queueNames) {
      const queue = new Queue(name, { connection });
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed"
      );
      console.log(`${name}:`);
      Object.entries(counts).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
      console.log("");
      await queue.close();
    }

    await connection.quit();
  } catch (error) {
    console.error("Failed to fetch queue status. Ensure bullmq/ioredis are installed.", error.message ?? error);
  }
}

async function listQueuesFromDir(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((file) => file.endsWith(".queue.ts") || file.endsWith(".queue.js"))
      .map((file) => file.replace(/\.queue\.(ts|js)$/g, ""));
  } catch {
    return [];
  }
}

async function createRedisClient(url) {
  try {
    const IORedis = (await import("ioredis")).default;
    if (url) {
      return new IORedis(url);
    }
    return new IORedis({
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    });
  } catch (error) {
    console.error("ioredis is required for this command. Install it in the current project.");
    return null;
  }
}

async function scaffoldMcpTemplate({ projectRoot, serverDirAbs, force }) {
  const mcpServiceDir = path.join(serverDirAbs, "services", "mcp");
  const mcpFeatureDir = path.join(serverDirAbs, "features", "mcp");
  const toolsDir = path.join(mcpFeatureDir, "tools");
  await ensureDir(mcpServiceDir);
  await ensureDir(mcpFeatureDir);
  await ensureDir(toolsDir);

  await writeFile(
    path.join(mcpServiceDir, "mcp.service.ts"),
    getMcpServiceTemplate(),
    force
  );

  await writeFile(
    path.join(mcpServiceDir, "server.ts"),
    getMcpServerEntryTemplate(),
    force
  );

  await writeFile(
    path.join(toolsDir, "ping.tool.ts"),
    getMcpToolTemplate("ping"),
    force
  );

  const toolsIndexFile = path.join(toolsDir, "index.ts");
  await writeFile(
    toolsIndexFile,
    getMcpToolsIndexTemplate(),
    force
  );
  await linkMcpTool(toolsIndexFile, "ping");

  const routesFile = path.join(mcpFeatureDir, "routes.ts");
  await writeFile(routesFile, getMcpRoutesTemplate(), force);

  const masterRoutesFile = path.join(serverDirAbs, "routes", "index.ts");
  await injectFeatureImport(masterRoutesFile, "mcp");

  console.log("[mcp] MCP server scaffolding created");
}

async function scaffoldDockerTemplate({ projectRoot, force }) {
  await writeFile(
    path.join(projectRoot, "docker-compose.yml"),
    getDockerComposeTemplate(),
    force
  );

  await writeFile(
    path.join(projectRoot, "Dockerfile"),
    getDockerfileTemplate(),
    force
  );

  await writeFile(
    path.join(projectRoot, "Dockerfile.mcp"),
    getDockerfileMcpTemplate(),
    force
  );

  await writeFile(
    path.join(projectRoot, ".dockerignore"),
    getDockerIgnoreTemplate(),
    false
  );

  const envExamplePath = path.join(projectRoot, ".env.example");
  if (!(await fileExists(envExamplePath))) {
    await fs.writeFile(envExamplePath, getEnvExampleTemplate(), "utf8");
    console.log("[docker] .env.example created");
  }

  await ensurePackageJsonScripts(projectRoot, {
    "docker:up": "docker compose up app postgres redis mcp-server",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f app",
  });

  console.log("[docker] docker-compose.yml, Dockerfile, Dockerfile.mcp created");
}

async function scaffoldMcpTool({ toolsDir, indexPath, name, force }) {
  await ensureDir(toolsDir);
  await ensureDir(path.dirname(indexPath));
  const toolFile = path.join(toolsDir, `${name}.tool.ts`);
  await writeFile(toolFile, getMcpToolTemplate(name), force);
  await linkMcpTool(indexPath, name);
  console.log(`[mcp] tool '${name}' created at ${path.relative(process.cwd(), toolFile)}`);
}

function getCacheServiceTemplate(provider) {
  const imports = [];
  if (provider === "redis") {
    imports.push('import IORedis from "ioredis";');
  }
  if (provider === "upstash") {
    imports.push('import { Redis as UpstashRedis } from "@upstash/redis";');
  }

  const redisProvider = `class RedisCacheProvider implements CacheProvider {
  private client: IORedis;
  constructor() {
    this.client = new IORedis({
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      keyPrefix: "fast-next:"
    });
  }

  async get(key: string) {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set(key: string, value: unknown, ttl?: number) {
    const payload = JSON.stringify(value);
    if (ttl) {
      await this.client.setex(key, ttl, payload);
    } else {
      await this.client.set(key, payload);
    }
  }

  async delete(key: string) {
    await this.client.del(key);
  }
}`;

  const upstashProvider = `class UpstashCacheProvider implements CacheProvider {
  private client: UpstashRedis;
  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error("UPSTASH credentials are required when CACHE_PROVIDER=upstash");
    }
    this.client = new UpstashRedis({ url, token });
  }

  async get(key: string) {
    const value = await this.client.get<string>(key);
    return value ? JSON.parse(value) : null;
  }

  async set(key: string, value: unknown, ttl?: number) {
    const payload = JSON.stringify(value);
    if (ttl) {
      await this.client.setex(key, ttl, payload);
    } else {
      await this.client.set(key, payload);
    }
  }

  async delete(key: string) {
    await this.client.del(key);
  }
}`;

  const providerSwitch = `type CacheProviderName = "memory" | "redis" | "upstash";

export function createCacheService(providerName: CacheProviderName = "${provider}") {
  const resolved = (process.env.CACHE_PROVIDER ?? providerName) as CacheProviderName;
  switch (resolved) {
    case "redis":
      return new CacheService(new RedisCacheProvider());
    case "upstash":
      return new CacheService(new UpstashCacheProvider());
    default:
      return new CacheService(new MemoryCacheProvider());
  }
}

export const cache = createCacheService();
`;

  const providerClasses = [
    `class MemoryCacheProvider implements CacheProvider {
  private cache = new Map<string, { value: unknown; expiresAt?: number }>();

  async get(key: string) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: unknown, ttl?: number) {
    this.cache.set(key, {
      value,
      expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
    });
  }

  async delete(key: string) {
    this.cache.delete(key);
  }
}`,
  ];

  if (provider === "redis") {
    providerClasses.push(redisProvider);
  }
  if (provider === "upstash") {
    providerClasses.push(upstashProvider);
  }

  return `${imports.join("\n")}

export interface CacheProvider {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class CacheService {
  constructor(private readonly provider: CacheProvider) {}

  async get<T>(key: string) {
    return this.provider.get<T>(key);
  }

  async set(key: string, value: unknown, ttl?: number) {
    await this.provider.set(key, value, ttl);
  }

  async wrap<T>(key: string, fn: () => Promise<T>, ttl = 60) {
    const cached = await this.provider.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
    const fresh = await fn();
    await this.provider.set(key, fresh, ttl);
    return fresh;
  }

  async delete(key: string) {
    await this.provider.delete(key);
  }
}

${providerClasses.join("\n\n")}

${providerSwitch}`;
}

function getQueueServiceTemplate() {
  return `import { Queue, Worker, QueueScheduler, type JobsOptions, type QueueOptions, type WorkerOptions, type Job } from "bullmq";
import IORedis from "ioredis";

type QueueConfig = QueueOptions & {
  defaultJobOptions?: JobsOptions;
};

const sharedConnection = new IORedis({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});

export class QueueService {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private schedulers = new Map<string, QueueScheduler>();

  constructor(private readonly connectionFactory = () => sharedConnection.duplicate()) {}

  registerQueue<T = unknown>(name: string, options?: QueueConfig) {
    if (this.queues.has(name)) {
      return this.queues.get(name) as Queue<T>;
    }

    const queue = new Queue<T>(name, {
      connection: this.connectionFactory(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
      ...options,
    });

    const scheduler = new QueueScheduler(name, {
      connection: this.connectionFactory(),
    });

    this.queues.set(name, queue);
    this.schedulers.set(name, scheduler);
    return queue;
  }

  registerWorker<T = unknown>(
    name: string,
    processor: (job: Job<T>) => Promise<unknown>,
    options?: WorkerOptions
  ) {
    if (!this.queues.has(name)) {
      this.registerQueue<T>(name);
    }

    const worker = new Worker<T>(name, processor, {
      connection: this.connectionFactory(),
      concurrency: 5,
      ...options,
    });

    worker.on("completed", (job) => {
      console.log(`[queue:${name}] job ${job.id} completed`);
    });

    worker.on("failed", (job, error) => {
      console.error(`[queue:${name}] job ${job?.id} failed`, error);
    });

    this.workers.set(name, worker);
    return worker;
  }
}

export const queueService = new QueueService();
`;
}

function getQueueExampleTemplate() {
  return `import { queueService } from "../services/queue.service";

export type EmailPayload = {
  to: string;
  subject: string;
  body: string;
};

export const emailQueue = queueService.registerQueue<EmailPayload>("email");

export async function enqueueEmail(payload: EmailPayload) {
  return emailQueue.add("send-email", payload, {
    priority: 1,
  });
}
`;
}

function getQueueWorkerTemplate() {
  return `import type { Job } from "bullmq";
import { queueService } from "../services/queue.service";
import { emailQueue, type EmailPayload } from "../queues/email.queue";

queueService.registerWorker<EmailPayload>(emailQueue.name, async (job: Job<EmailPayload>) => {
  const { to, subject, body } = job.data;
  console.log(`[worker] sending email to ${to}: ${subject}`);
  console.log(body);
  return { deliveredAt: Date.now() };
});
`;
}

function getQueueWorkerIndexTemplate() {
  return `import "./email.worker";

console.log("[workers] email worker registered");
`;
}

function getCustomQueueTemplate(name) {
  const pascal = toPascalCase(name);
  return `import { queueService } from "../services/queue.service";

export type ${pascal}Payload = Record<string, unknown>;

export const ${name}Queue = queueService.registerQueue<${pascal}Payload>("${name}");

export async function enqueue${pascal}(jobName: string, payload: ${pascal}Payload) {
  return ${name}Queue.add(jobName, payload);
}
`;
}

function getCustomWorkerTemplate(name) {
  const pascal = toPascalCase(name);
  return `import type { Job } from "bullmq";
import { queueService } from "../services/queue.service";
import { ${name}Queue, type ${pascal}Payload } from "../queues/${name}.queue";

queueService.registerWorker<${pascal}Payload>(${name}Queue.name, async (job: Job<${pascal}Payload>) => {
  console.log(`[${name} worker] received job ${job.name}`, job.data);
  return { handledAt: Date.now() };
});
`;
}

function getMcpServiceTemplate() {
  return `import { MCPServer } from "@modelcontextprotocol/sdk";

type ToolConfig = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown) => Promise<unknown>;
};

export class FastNextMcpServer {
  private readonly server = new MCPServer({
    name: "fast-next-mcp",
    version: "0.1.0",
    capabilities: {
      tools: true,
    },
  });

  private readonly tools = new Map<string, ToolConfig>();

  registerTool(tool: ToolConfig) {
    if (this.tools.has(tool.name)) {
      return;
    }
    this.tools.set(tool.name, tool);
    this.server.addTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      handler: tool.handler,
    });
  }

  listTools() {
    return Array.from(this.tools.values()).map(({ handler, ...meta }) => meta);
  }

  getTool(name: string) {
    return this.tools.get(name);
  }

  async start(port = Number(process.env.MCP_PORT ?? 3001)) {
    await this.server.listen(port);
    console.log(`[mcp] server listening on port ${port}`);
  }
}

export const mcpServer = new FastNextMcpServer();
`;
}

function getMcpServerEntryTemplate() {
  return `import { mcpServer } from "./mcp.service";
import "../../features/mcp/tools/ping.tool";

void mcpServer.start().catch((error) => {
  console.error("[mcp] failed to start", error);
});
`;
}

function getMcpToolTemplate(name = "ping") {
  const description = name === "ping" ? "Return a pong response to test connectivity" : `Tool '${name}' generated via CLI`;
  return `import { mcpServer } from "../../services/mcp/mcp.service";

mcpServer.registerTool({
  name: "${name}",
  description: "${description}",
  inputSchema: {
    type: "object",
    properties: {
      payload: {
        type: "object",
        description: "Tool-specific payload",
      },
    },
  },
  handler: async (input: { payload?: Record<string, unknown> }) => {
    return {
      tool: "${name}",
      echo: input?.payload ?? null,
      timestamp: Date.now(),
    };
  },
});
`;
}

function getMcpToolsIndexTemplate() {
  return `// FAST_NEXT_MCP_TOOL_IMPORTS
`;
}

function getMcpRoutesTemplate() {
  return `import { createRoute, type FastifyRouteDefinition } from "@fast-next/fastify-router";
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
`;
}

function getDockerComposeTemplate() {
  return `version: "3.9"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    command: pnpm dev --hostname 0.0.0.0 --port 3000
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - .:/app
      - /app/node_modules
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: fast_next
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  mcp-server:
    build:
      context: .
      dockerfile: Dockerfile.mcp
    command: pnpm exec tsx src/server/services/mcp/server.ts
    environment:
      MCP_PORT: 3001
    ports:
      - "3001:3001"
    depends_on:
      app:
        condition: service_started
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
`;
}

function getDockerIgnoreTemplate() {
  return `node_modules
.turbo
.next
dist
*.log
.env
`;}

function getEnvExampleTemplate() {
  return `# App
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fast_next

# Redis / Queue
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Cache providers
CACHE_PROVIDER=memory
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# MCP server
MCP_PORT=3001
`;
}

function getDockerfileTemplate() {
  return `FROM node:20-alpine

RUN corepack enable && apk add --no-cache bash curl

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY . .

EXPOSE 3000

CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]
`;
}

function getDockerfileMcpTemplate() {
  return `FROM node:20-alpine

RUN corepack enable && apk add --no-cache bash curl

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY . .

EXPOSE 3001

CMD ["pnpm", "exec", "tsx", "src/server/services/mcp/server.ts"]
`;
}

async function linkMcpTool(indexPath, name) {
  const marker = "// FAST_NEXT_MCP_TOOL_IMPORTS";
  let content;
  if (await fileExists(indexPath)) {
    content = await fs.readFile(indexPath, "utf8");
  } else {
    content = getMcpToolsIndexTemplate();
  }

  if (content.includes(`"./${name}.tool"`)) {
    await fs.writeFile(indexPath, content, "utf8");
    return;
  }

  if (!content.includes(marker)) {
    content = `${marker}\n${content}`;
  }

  const importLine = `import "./${name}.tool";\n`;
  const next = content.replace(marker, `${importLine}${marker}`);
  await fs.writeFile(indexPath, next, "utf8");
}

async function listMcpTools(indexPath) {
  if (!(await fileExists(indexPath))) {
    console.log("No MCP tools registered yet.");
    return;
  }
  const content = await fs.readFile(indexPath, "utf8");
  const matches = [...content.matchAll(/import \"\.\/(.+?)\.tool\";/g)].map((match) => match[1]);
  if (!matches.length) {
    console.log("No MCP tools registered yet.");
    return;
  }
  console.log("Registered MCP tools:\n");
  matches.forEach((tool) => console.log(`- ${tool}`));
}

function getPackageRunner(manager, execArgs) {
  const trimmed = execArgs[0] === "exec" ? execArgs.slice(1) : execArgs;
  switch (manager) {
    case "pnpm":
      return { bin: "pnpm", args: execArgs };
    case "npm":
      return { bin: "npm", args: ["exec", ...trimmed] };
    case "yarn":
      return { bin: "yarn", args: trimmed };
    case "bun":
      return { bin: "bun", args: ["x", ...trimmed] };
    default:
      return { bin: manager, args: execArgs };
  }
}

function spawnInteractive(bin, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${bin} exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

await main();
