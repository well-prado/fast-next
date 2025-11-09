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

Options:
  --app <path>       Relative path to the Next.js app directory (default: app)
  --server <path>    Relative path to the server folder (default: src/server)
  --api <path>       Relative path to the API catch-all folder (default: <app>/api/[...fastify])
  --install <pm>     Install dependencies with pnpm|npm|yarn|bun|auto|skip (default: prompt in TTY)
  --with-queue       Include BullMQ queue scaffolding
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

const INSTALL_COMMANDS = {
  pnpm: {
    bin: "pnpm",
    args: ["add", ...CORE_DEPENDENCIES],
  },
  npm: {
    bin: "npm",
    args: ["install", ...CORE_DEPENDENCIES],
  },
  yarn: {
    bin: "yarn",
    args: ["add", ...CORE_DEPENDENCIES],
  },
  bun: {
    bin: "bun",
    args: ["add", ...CORE_DEPENDENCIES],
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

  if (installChoice && installChoice !== "skip") {
    await ensurePackageJsonDeps(projectRoot, Array.from(dependencySet));
    await installDependencies(installChoice, projectRoot);
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

async function installDependencies(manager, cwd) {
  const config = INSTALL_COMMANDS[manager];
  if (!config) {
    console.warn(`[warn] Unsupported package manager '${manager}', skipping install.`);
    return;
  }
  console.log(`\nInstalling dependencies with ${manager}...\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(config.bin, config.args, {
      cwd,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${config.bin} exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
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

await main();
