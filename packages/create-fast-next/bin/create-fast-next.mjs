#!/usr/bin/env node
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import enquirer from "enquirer";

const { prompt } = enquirer;

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
  --orm <none|prisma|drizzle> Select ORM integration (default: prompt)
  --db <sqlite|postgres|mysql> Select database when ORM is enabled
  --install <pm>     Install dependencies with pnpm|npm|yarn|bun|auto|skip (default: prompt in TTY)
  --with-queue       Include BullMQ queue scaffolding
  --with-cache <provider> Include cache service (memory|redis|upstash)
  --with-auth        Include Better Auth bridge (Next.js handlers + Fastify plugin)
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
  upstash: [],
};
const AUTH_DEPENDENCIES = ["@fast-next/better-auth"];
const MCP_DEPENDENCIES = ["@modelcontextprotocol/sdk"];
const DEP_VERSION_OVERRIDES = {
  zod: "^3.25.0",
};
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
  const interactive = !options.yes;
  const projectDirInput =
    options._[0] ?? (await promptInput("Project directory", ".", interactive));
  const projectRoot = path.resolve(process.cwd(), projectDirInput);
  const appDir = options.app ?? (await promptInput("Next.js app directory", "app", interactive));
  const serverDir =
    options.server ??
    (await promptInput("Server directory", path.join("src", "server"), interactive));
  const apiDir =
    options.api ??
    (await promptInput(
      "API catch-all path",
      path.join(appDir, "api", "[...fastify]"),
      interactive,
    ));
  const force = Boolean(options.force);
  const ormChoice = await resolveOrmOption(options.orm, options.db, interactive);
  const featureToggles = await resolveFeatureSelections(options, interactive);
  const { queueEnabled, cacheOption, authEnabled, mcpEnabled, dockerEnabled } = featureToggles;
  const installChoice = await resolveInstallChoice(options.install, projectRoot, interactive);

  const appDirAbs = path.join(projectRoot, appDir);
  const routeFile = path.join(projectRoot, apiDir, "route.ts");
  const serverDirAbs = path.join(projectRoot, serverDir);
  const fastifyAppFile = path.join(serverDirAbs, "fastify-app.ts");
  const routesFile = path.join(serverDirAbs, "routes", "index.ts");
  const apiHelperFile = path.join(serverDirAbs, "api.ts");
  const featuresDir = path.join(serverDirAbs, "features");
  const authServiceFile = path.join(serverDirAbs, "services", "auth", "better-auth.ts");
  const authRouteFile = path.join(appDirAbs, "api", "auth", "[...betterAuth]", "route.ts");
  const demoPageFile = path.join(appDirAbs, "demo", "page.tsx");
  const clientApiFile = path.join(projectRoot, "client", "api.ts");
  const clientComponentDir = path.join(projectRoot, "components");
  const projectsClientPanelFile = path.join(clientComponentDir, "projects-client-panel.tsx");
  const projectsClientPanelCssFile = path.join(
    clientComponentDir,
    "projects-client-panel.module.css",
  );

  await ensureDir(path.dirname(routeFile));
  await ensureDir(path.dirname(fastifyAppFile));
  await ensureDir(path.dirname(routesFile));
  await ensureDir(featuresDir);

  const relativeImportToFastifyApp = toImportPath(
    path.relative(path.dirname(routeFile), fastifyAppFile),
  );

  await writeFile(routeFile, getRouteHandlerTemplate(relativeImportToFastifyApp), force);
  const fastifyAuthImportPath = toImportPath(
    path.relative(path.dirname(fastifyAppFile), authServiceFile),
  );
  await writeFile(
    fastifyAppFile,
    getFastifyAppTemplate({
      includeAuth: authEnabled,
      authImportPath: fastifyAuthImportPath,
    }),
    force,
  );
  await writeFile(routesFile, getRoutesIndexTemplate(), force);
  await writeFile(apiHelperFile, getServerApiTemplate(), force);
  await writeFile(path.join(featuresDir, ".gitkeep"), "", false);
  await writeFile(clientApiFile, getBrowserClientTemplate(), force);
  await writeFile(projectsClientPanelFile, getProjectsClientPanelTemplate(), force);
  await writeFile(projectsClientPanelCssFile, getProjectsClientPanelCss(), force);
  await writeFile(demoPageFile, getDemoPageTemplate(), force);

  const dependencySet = new Set(CORE_DEPENDENCIES);
  const postInitNotes = [];

  if (ormChoice.orm !== "none") {
    await scaffoldOrm({ projectRoot, serverDirAbs, force, choice: ormChoice });
    ormChoice.dependencies.forEach((dep) => {
      dependencySet.add(dep);
    });
    postInitNotes.push(...ormChoice.notes);
  }

  if (queueEnabled) {
    await scaffoldQueueTemplate({ serverDirAbs, force });
    QUEUE_DEPENDENCIES.forEach((dep) => {
      dependencySet.add(dep);
    });
    const workersEntry = path.relative(projectRoot, path.join(serverDirAbs, "workers", "index.ts"));
    postInitNotes.push(
      "Configure REDIS_HOST/REDIS_PORT/REDIS_PASSWORD in your environment before running queues.",
      `Start workers with ts-node/tsx (e.g., 'pnpm exec tsx ${workersEntry}') in a separate process.`,
    );
  }

  if (cacheOption.enabled) {
    await scaffoldCacheTemplate({
      projectRoot,
      serverDirAbs,
      force,
      provider: cacheOption.provider,
    });
    const deps = CACHE_DEPENDENCIES[cacheOption.provider] ?? [];
    deps.forEach((dep) => {
      dependencySet.add(dep);
    });
    postInitNotes.push(
      `Cache provider '${cacheOption.provider}' scaffolded. Configure env vars (see src/server/services/cache/cache.service.ts).`,
    );
  }

  if (authEnabled) {
    await scaffoldAuthTemplate({
      authRouteFile,
      authServiceFile,
      force,
    });
    AUTH_DEPENDENCIES.forEach((dep) => {
      dependencySet.add(dep);
    });
    postInitNotes.push(
      "Better Auth scaffolding created. Update services/auth/better-auth.ts with your adapter, secrets, and providers before enabling the routes.",
    );
  }

  if (mcpEnabled) {
    await scaffoldMcpTemplate({ serverDirAbs, force });
    MCP_DEPENDENCIES.forEach((dep) => {
      dependencySet.add(dep);
    });
    postInitNotes.push(
      "MCP server files created under services/mcp. Start it with 'pnpm exec tsx src/server/services/mcp/server.ts'.",
    );
  }

  if (dockerEnabled) {
    await scaffoldDockerTemplate({ projectRoot, force });
    postInitNotes.push(
      "docker-compose.yml generated. Update .env before running 'docker compose up'.",
    );
  }

  if (installChoice && installChoice !== "skip") {
    await ensurePackageJsonDeps(projectRoot, Array.from(dependencySet));
    await installDependencies(installChoice, projectRoot, Array.from(dependencySet));
  } else {
    console.log("\nDependencies to install:");
    console.log(`  ${Array.from(dependencySet).join(" ")}`);
    console.log("Use your preferred package manager (e.g. 'pnpm add ...').");
  }

  console.log("\nNext steps:\n");
  console.log(
    "1. Ensure your tsconfig.json maps '@/*' to your source directory if you plan to use alias imports.",
  );
  console.log("2. Start Next.js with 'pnpm dev' and hit /api/health to verify the bridge.");
  console.log(
    "3. Visit /demo to exercise the server action + client hook playground that ships with the scaffold.",
  );
  if (postInitNotes.length) {
    console.log("\nAdditional notes:");
    postInitNotes.forEach((note) => {
      console.log(`- ${note}`);
    });
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
    await scaffoldCustomQueue({
      projectRoot,
      name: options._[1],
      serverDir,
      force: Boolean(options.force),
    });
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
  const serverDir = options.server ?? path.join("src", "server");
  const entry = options.entry ?? path.join(serverDir, "services", "mcp", "server.ts");
  const entryAbs = path.join(projectRoot, entry);
  const packageManager = detectPackageManager(projectRoot) ?? "pnpm";
  const toolsDir = path.join(
    projectRoot,
    options.tools ?? path.join(serverDir, "features", "mcp", "tools"),
  );
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
    await scaffoldMcpTool({
      toolsDir,
      indexPath,
      name,
      force: Boolean(options.force),
    });
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

function getFastifyAppTemplate(options = {}) {
  const { includeAuth = false, authImportPath } = options;
  const authImports =
    includeAuth && authImportPath
      ? `import { createFastifyBetterAuthPlugin } from "@fast-next/better-auth";
import { auth } from "${authImportPath}";\n\n`
      : "";
  const pluginsLine =
    includeAuth && authImportPath
      ? "    plugins: [createFastifyBetterAuthPlugin({ auth })],\n"
      : "";

  return `import { getFastifyApp } from "@fast-next/fastify-app-factory";
import { registerRoutes } from "./routes";
${authImports}export function getAppInstance() {
  return getFastifyApp({
${pluginsLine}    configureApp: registerRoutes,
  });
}
`;
}

function getRoutesIndexTemplate() {
  return `import type { FastifyInstance } from "fastify";
import {
  createRoute,
  registerRoutes as registerFastifyRoutes,
  type FastifyRouteDefinition,
} from "@fast-next/fastify-router";
import type { TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";

// FAST_NEXT_ROUTE_IMPORTS

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  title: z.string(),
});

const errorSchema = z.object({
  error: z.string(),
});

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "archived"]),
});

const USERS = [
  {
    id: "1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    title: "Analyst",
  },
  {
    id: "2",
    name: "Alan Turing",
    email: "alan@example.com",
    title: "Researcher",
  },
  {
    id: "3",
    name: "Grace Hopper",
    email: "grace@example.com",
    title: "Commodore",
  },
] as const;

const initialProjects: Project[] = [
  { id: "p1", name: "DX Overhaul", status: "active" },
  { id: "p2", name: "Edge API Gateway", status: "draft" },
  { id: "p3", name: "Realtime Sync", status: "archived" },
];

let projects: Project[] = [...initialProjects];

const healthSchema = {
  response: z.object({
    status: z.literal("ok"),
  }),
} as const;

const getUserSchema = {
  params: z.object({
    id: z.string(),
  }),
  response: {
    200: userSchema,
    404: errorSchema,
  },
} as const;

const listProjectsSchema = {
  response: z.object({
    items: z.array(projectSchema),
  }),
} as const;

const getProjectSchema = {
  params: z.object({
    id: z.string(),
  }),
  response: {
    200: projectSchema,
    404: errorSchema,
  },
} as const;

const createProjectSchema = {
  body: z.object({
    name: z.string().min(3),
    status: projectSchema.shape.status.optional().default("draft"),
  }),
  response: {
    201: projectSchema,
  },
} as const;

export const serverRoutes = [
  createRoute({
    method: "GET",
    path: "/health",
    resource: "system",
    operation: "health",
    schema: healthSchema,
    handler: (async () => {
      return { status: "ok" as const };
    }) satisfies TypedRouteHandler<typeof healthSchema>,
  }),
  createRoute({
    method: "GET",
    path: "/users/:id",
    resource: "users",
    operation: "get",
    schema: getUserSchema,
    handler: (async (request, reply) => {
      const user = USERS.find((candidate) => candidate.id === request.params.id);

      if (!user) {
        reply.code(404);
        return { error: "User not found" };
      }

      return user;
    }) satisfies TypedRouteHandler<typeof getUserSchema>,
  }),
  createRoute({
    method: "GET",
    path: "/projects",
    resource: "projects",
    operation: "list",
    schema: listProjectsSchema,
    handler: (async () => ({
      items: projects,
    })) satisfies TypedRouteHandler<typeof listProjectsSchema>,
  }),
  createRoute({
    method: "GET",
    path: "/projects/:id",
    resource: "projects",
    operation: "get",
    schema: getProjectSchema,
    handler: (async ({ params }, reply) => {
      const project = projects.find((candidate) => candidate.id === params.id);

      if (!project) {
        reply.code(404);
        return { error: "Project not found" };
      }

      return project;
    }) satisfies TypedRouteHandler<typeof getProjectSchema>,
  }),
  createRoute({
    method: "POST",
    path: "/projects",
    resource: "projects",
    operation: "create",
    schema: createProjectSchema,
    handler: (async (request, reply) => {
      const payload = request.body;
      const newProject = {
        id: \`p\${projects.length + 1}\`,
        name: payload.name,
        status: payload.status ?? "draft",
      } as const;

      projects = [...projects, newProject];
      reply.code(201);
      return newProject;
    }) satisfies TypedRouteHandler<typeof createProjectSchema>,
  }),
  // FAST_NEXT_ROUTE_SPREAD
] as const satisfies readonly FastifyRouteDefinition[];

export type ServerRoutes = typeof serverRoutes;
export type ServerRoute = ServerRoutes[number];
export type User = z.infer<typeof userSchema>;
export type Project = z.infer<typeof projectSchema>;

export async function registerRoutes(app: FastifyInstance) {
  await registerFastifyRoutes(app, serverRoutes);
}
`;
}

function getServerApiTemplate() {
  return `import { createServerCaller } from "@fast-next/fastify-server-caller";
import { createServerClient, FastifyQueryClient } from "@fast-next/fastify-server-client";
import type { FastifyCaller } from "@fast-next/fastify-server-client";
import type { BuiltRouter } from "@fast-next/fastify-zod-router";
import { registerRoutes, serverRoutes } from "./routes";

const builtRouter = {
  routes: serverRoutes,
  register: registerRoutes,
} satisfies BuiltRouter<typeof serverRoutes>;

export const serverCaller = createServerCaller(builtRouter);
export const api = createServerClient(serverRoutes, serverCaller as FastifyCaller<typeof serverRoutes>);
export const queryClient = new FastifyQueryClient();
`;
}

function getBrowserClientTemplate() {
  return `"use client";

import { createBrowserClient } from "@fast-next/fastify-browser-client";
import { FastifyQueryClient } from "@fast-next/fastify-query-client";
import { serverRoutes } from "@/server/routes";

const clientQueryCache = new FastifyQueryClient();

export const api = createBrowserClient(serverRoutes, {
  baseUrl: "/api",
  queryClient: clientQueryCache,
});
`;
}

function getProjectsClientPanelTemplate() {
  return `"use client";

import { useMemo, useState, type FormEvent } from "react";
import { api } from "@/client/api";
import styles from "./projects-client-panel.module.css";

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
] as const;

export function ProjectsClientPanel() {
  const [projectName, setProjectName] = useState("");
  const [status, setStatus] =
    useState<(typeof STATUS_OPTIONS)[number]["value"]>("draft");

  const query = api.projects.list.useQuery({
    refetchOnWindowFocus: false,
  });
  const mutation = api.projects.create.useMutation({
    invalidate: { resource: "projects" },
  });

  const projects = useMemo(
    () => query.response?.data?.items ?? [],
    [query.response],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    mutation.mutate({
      body: {
        name: projectName || \`Client project \${projects.length + 1}\`,
        status,
      },
    });

    setProjectName("");
  };

  return (
    <section className={styles.wrapper}>
      <header className={styles.header}>
        <div>
          <h3>Client-side projects</h3>
          <p>Browser API with TanStack-style hooks.</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            Refresh
          </button>
        </div>
      </header>

      {query.isError && (
        <p className={styles.error}>Failed to load projects.</p>
      )}

      <ul className={styles.list}>
        {query.isLoading && projects.length === 0 && (
          <li className={styles.placeholder}>Loading projects…</li>
        )}
        {projects.map((project) => (
          <li key={project.id} className={styles.item}>
            <span>{project.name}</span>
            <span className={styles.badge}>{project.status}</span>
          </li>
        ))}
        {!query.isLoading && projects.length === 0 && (
          <li className={styles.placeholder}>No projects yet.</li>
        )}
      </ul>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder="New project name"
          aria-label="Project name"
        />
        <select
          value={status}
          onChange={(event) =>
            setStatus(
              event.target.value as (typeof STATUS_OPTIONS)[number]["value"],
            )
          }
          aria-label="Project status"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Creating…" : "Create"}
        </button>
      </form>
    </section>
  );
}
`;
}

function getProjectsClientPanelCss() {
  return `.panel {
  border-radius: 26px;
  padding: 24px 26px;
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border: none;
  box-shadow:
    0 25px 55px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 1px 0 color-mix(in srgb, var(--foreground) 8%, transparent);
}

.wrapper {
  composes: panel;
  font-family: var(--font-geist-sans);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.header h3 {
  font-size: 1.35rem;
  margin: 0;
}

.header p {
  margin: 4px 0 0;
  color: color-mix(in srgb, var(--foreground) 70%, transparent);
}

.actions button {
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--foreground) 18%, transparent);
  padding: 6px 14px;
  background: transparent;
  cursor: pointer;
}

.actions button:hover:not(:disabled) {
  background: var(--foreground);
  color: var(--background);
}

.actions button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.error {
  color: #c62828;
  font-weight: 600;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
}

.placeholder {
  font-style: italic;
  color: color-mix(in srgb, var(--foreground) 65%, transparent);
}

.badge {
  text-transform: uppercase;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--foreground) 10%, transparent);
}

.form {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}

.form input,
.form select {
  font: inherit;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--foreground) 20%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--background) 80%, transparent);
  background: color-mix(in srgb, var(--background) 97%, transparent);
  min-width: 140px;
  flex: 1;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.form input:focus-visible,
.form select:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--foreground) 35%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--foreground) 35%, transparent),
    0 0 0 3px color-mix(in srgb, var(--foreground) 20%, transparent);
}

.form button {
  border-radius: 10px;
  border: 1px solid var(--foreground);
  background: var(--foreground);
  color: var(--background);
  padding: 9px 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.form button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--foreground) 80%, transparent);
  color: var(--background);
}

.form button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
`;
}

function getDemoPageTemplate() {
  return `import { revalidatePath } from "next/cache";
import Image from "next/image";
import Link from "next/link";

import { ProjectsClientPanel } from "@/components/projects-client-panel";
import panelStyles from "@/components/projects-client-panel.module.css";
import { api } from "@/server/api";
import type { Project } from "@/server/routes";

const STATUS_OPTIONS = ["draft", "active", "archived"] as const;

async function createDemoProject(formData: FormData) {
  "use server";

  const rawName = formData.get("name")?.toString().trim();
  const status = formData.get("status")?.toString() ?? "draft";
  const normalizedStatus = STATUS_OPTIONS.includes(
    status as (typeof STATUS_OPTIONS)[number],
  )
    ? (status as (typeof STATUS_OPTIONS)[number])
    : "draft";
  const name =
    rawName && rawName.length > 0
      ? rawName
      : \`Playground project \${Date.now().toString().slice(-4)}\`;

  await api.projects.create.mutate({
    body: {
      name,
      status: normalizedStatus,
    },
  });

  revalidatePath("/demo");
}

export default async function DemoPage() {
  const [healthResult, projectsResult] = await Promise.all([
    api.system.health.query().catch(() => null),
    api.projects.list.query().catch(() => null),
  ]);

  const projects = (projectsResult?.data?.items ?? []) as Project[];
  const recentProjects = projects.slice(0, 5);
  const health = healthResult?.data?.status ?? "unknown";

  return (
    <div className="min-h-screen bg-background px-6 py-12 text-foreground sm:px-10 lg:px-24">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className={\`\${panelStyles.panel} flex flex-col gap-6\`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-foreground/70">
                Fast Next demo
              </p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight">
                Server + Client Fastify playground
              </h1>
            </div>
            <Link
              href="/"
              className="rounded-full border border-foreground/30 px-4 py-2 text-sm font-medium transition hover:border-foreground hover:bg-foreground hover:text-background"
            >
              ← Back home
            </Link>
          </div>
          <p className="text-base text-foreground/80">
            This page renders server data directly from{" "}
            <code className="rounded bg-foreground/10 px-2 py-1 text-xs">
              api.system.health
            </code>{" "}
            and{" "}
            <code className="rounded bg-foreground/10 px-2 py-1 text-xs">
              api.projects.list
            </code>{" "}
            while the panel below uses the generated browser client to mutate
            through Fastify routes.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-2">
          <ServerShowcase
            health={health}
            projects={projects}
            recentProjects={recentProjects}
          />
          <ProjectsClientPanel />
        </div>
      </div>
    </div>
  );
}

function ServerShowcase({
  health,
  projects,
  recentProjects,
}: {
  health: string;
  projects: Project[];
  recentProjects: Project[];
}) {
  const ok = health === "ok";

  return (
    <section className={\`\${panelStyles.panel} flex h-full flex-col gap-6\`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-foreground/60">
            Server rendered
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Fastify API snapshot</h2>
        </div>
        <Image
          src="/next.svg"
          alt="Next.js Logo"
          width={90}
          height={20}
          className="dark:invert"
        />
      </div>

      <dl className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <dt>Status</dt>
          <dd
            className={\`rounded-full px-3 py-1 text-xs font-semibold uppercase \${ ok
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100"}\`}
          >
            {health}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt>Summary</dt>
          <dd className="text-right text-base font-medium">
            {ok ? "Fastify is serving requests" : "Check server connection"}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt>Total projects</dt>
          <dd className="font-mono text-lg">{projects.length}</dd>
        </div>
      </dl>

      {recentProjects.length > 0 && (
        <div className={\`\${panelStyles.panel} rounded-[20px] bg-background/90 p-4 shadow-inner shadow-black/10 dark:bg-black/50\`}>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-foreground/50">
            Recent projects
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {recentProjects.map((project) => (
              <li
                key={project.id ?? project.name}
                className="flex items-center justify-between"
              >
                <span className="truncate">{project.name}</span>
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  {project.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        action={createDemoProject}
        className="mt-auto flex flex-col gap-3 rounded-[22px] border border-foreground/20 bg-background/80 p-4 text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] sm:flex-row"
      >
        <label className="sr-only" htmlFor="project-name">
          Project name
        </label>
        <input
          id="project-name"
          name="name"
          placeholder="New project name"
          className="w-full rounded-xl border border-foreground/20 bg-background/95 px-3 py-1.5 text-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition focus-visible:outline-none focus-visible:border-foreground/35 focus-visible:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_0_0_3px_rgba(255,255,255,0.08)]"
        />
        <label className="sr-only" htmlFor="project-status">
          Project status
        </label>
        <select
          id="project-status"
          name="status"
          defaultValue="draft"
          className="w-full rounded-xl border border-foreground/20 bg-background/95 px-3 py-1.5 text-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition focus-visible:outline-none focus-visible:border-foreground/35 focus-visible:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),0_0_0_3px_rgba(255,255,255,0.08)] sm:max-w-[140px]"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-foreground px-4 py-1.5 text-sm font-medium text-foreground transition hover:bg-foreground hover:text-background"
        >
          Add
        </button>
      </form>
    </section>
  );
}
`;
}

function getBetterAuthServiceTemplate() {
  return `import type { BetterAuthOptions } from "@fast-next/better-auth";
import { createFastNextAuth } from "@fast-next/better-auth";

/**
 * Configure Better Auth adapters, providers, and secrets here.
 * Docs: https://better-auth.com/docs
 */
const authOptions = {
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  plugins: [],
} satisfies Partial<BetterAuthOptions>;

export const auth = createFastNextAuth(authOptions as BetterAuthOptions);
`;
}

function getBetterAuthRouteTemplate(authImportPath) {
  return `import { createNextAuthHandler } from "@fast-next/better-auth";
import { auth } from "${authImportPath}";

const handlers = createNextAuthHandler({ auth });

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
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
    id: "${camel}-" + Date.now(),
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
  const featureRoutesPath = path.join(
    path.dirname(routesFile),
    "..",
    "features",
    featureName,
    "routes.ts",
  );
  const relativeImport = toImportPath(path.relative(path.dirname(routesFile), featureRoutesPath));
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

async function resolveOrmOption(ormFlag, dbFlag, interactive) {
  const dbValue =
    dbFlag ??
    (await promptSelect(
      "Select database",
      ["none", "sqlite", "postgres", "mysql"],
      "sqlite",
      interactive,
    ));
  const db = dbValue.toLowerCase();
  if (!["none", "sqlite", "postgres", "mysql"].includes(db)) {
    throw new Error(`Unsupported database '${db}'. Choose none, sqlite, postgres, or mysql.`);
  }

  const ormInitial = ormFlag ? ormFlag.toLowerCase() : undefined;
  if (ormInitial === "none" || db === "none") {
    return { orm: "none", db: "sqlite", dependencies: [], notes: [] };
  }

  const ormValue =
    ormFlag ??
    (await promptSelect("Select ORM", ["prisma", "drizzle", "none"], "drizzle", interactive));
  const orm = ormValue.toLowerCase();
  if (!["prisma", "drizzle", "none"].includes(orm)) {
    throw new Error(`Unsupported orm '${orm}'. Choose prisma, drizzle, or none.`);
  }
  if (orm === "none") {
    return { orm: "none", db, dependencies: [], notes: [] };
  }

  const dependencies = new Set();
  const notes = [];

  if (orm === "prisma") {
    dependencies.add("prisma");
    dependencies.add("@prisma/client");
    notes.push("Run 'npx prisma generate' after installing dependencies.");
    notes.push("Update prisma/schema.prisma and run 'npx prisma migrate dev'.");
    if (db === "postgres") dependencies.add("@neondatabase/serverless");
  } else if (orm === "drizzle") {
    dependencies.add("drizzle-orm");
    dependencies.add("drizzle-kit");
    if (db === "sqlite") dependencies.add("better-sqlite3");
    if (db === "postgres") dependencies.add("pg");
    if (db === "mysql") dependencies.add("mysql2");
    notes.push("Configure drizzle.config.ts and run 'pnpm drizzle-kit generate'.");
  }

  return { orm, db, dependencies: Array.from(dependencies), notes };
}

async function promptInput(message, initial, interactive) {
  if (!interactive) {
    return initial;
  }
  const response = await prompt({
    type: "input",
    name: "value",
    message,
    initial,
  });
  const value = typeof response.value === "string" ? response.value.trim() : "";
  return value || initial;
}

async function promptSelect(message, choices, initial, interactive) {
  if (!interactive) {
    return initial;
  }
  const initialIndex = Math.max(0, choices.indexOf(initial ?? choices[0]));
  const response = await prompt({
    type: "select",
    name: "value",
    message,
    choices,
    initial: initialIndex,
  });
  return response.value;
}

async function resolveFeatureSelections(options, interactive) {
  const queueFlag = coerceBooleanFlag(options["with-queue"]);
  const authFlag = coerceBooleanFlag(options["with-auth"]);
  const mcpFlag = coerceBooleanFlag(options["with-mcp"]);
  const dockerFlag = coerceBooleanFlag(options["with-docker"]);
  const cacheFlag = coerceCacheOption(options["with-cache"]);

  const multiSelectChoices = [];
  if (queueFlag === undefined) {
    multiSelectChoices.push({ name: "queue", message: "BullMQ queues & workers" });
  }
  if (cacheFlag === undefined) {
    multiSelectChoices.push({ name: "cache", message: "Cache service (memory/redis/upstash)" });
  }
  if (authFlag === undefined) {
    multiSelectChoices.push({ name: "auth", message: "Better Auth integration" });
  }
  if (mcpFlag === undefined) {
    multiSelectChoices.push({ name: "mcp", message: "MCP server scaffold" });
  }
  if (dockerFlag === undefined) {
    multiSelectChoices.push({ name: "docker", message: "Docker & docker-compose templates" });
  }

  let selected = new Set();
  if (interactive && multiSelectChoices.length) {
    const response = await prompt({
      type: "multiselect",
      name: "features",
      message: "Select optional modules (space to toggle)",
      hint: "Use ↑/↓ to move, space to toggle, enter to confirm.",
      choices: multiSelectChoices.map((choice) => ({
        name: choice.name,
        message: choice.message,
        value: choice.name,
      })),
    });
    selected = new Set(response.features ?? []);
  }

  const queueEnabled = queueFlag ?? selected.has("queue");
  const authEnabled = authFlag ?? selected.has("auth");
  const mcpEnabled = mcpFlag ?? selected.has("mcp");
  const dockerEnabled = dockerFlag ?? selected.has("docker");

  let cacheOption;
  if (cacheFlag !== undefined) {
    cacheOption = cacheFlag;
  } else if (selected.has("cache")) {
    const provider = await promptSelect(
      "Select cache provider",
      ["memory", "redis", "upstash"],
      "memory",
      interactive,
    );
    cacheOption = { enabled: true, provider };
  } else {
    cacheOption = { enabled: false, provider: "memory" };
  }

  return { queueEnabled, authEnabled, mcpEnabled, dockerEnabled, cacheOption };
}

function coerceBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "n", "0"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function coerceCacheOption(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return { enabled: value, provider: "memory" };
  }
  const normalized = value.toLowerCase();
  if (["none", "false", "no", "n", "0"].includes(normalized)) {
    return { enabled: false, provider: "memory" };
  }
  if (["memory", "redis", "upstash"].includes(normalized)) {
    return { enabled: true, provider: normalized };
  }
  if (["true", "yes", "y", "1"].includes(normalized)) {
    return { enabled: true, provider: "memory" };
  }
  return undefined;
}

async function resolveInstallChoice(value, projectRoot, interactive) {
  const normalized = normalizeInstallChoiceValue(value);
  if (normalized && normalized !== "auto") {
    return normalized;
  }
  if (normalized === "auto") {
    return detectPackageManager(projectRoot) ?? "skip";
  }
  if (!interactive) {
    return "skip";
  }
  const defaultChoice = detectPackageManager(projectRoot) ?? "skip";
  return promptSelect(
    "Install dependencies now?",
    ["pnpm", "npm", "yarn", "bun", "skip"],
    defaultChoice,
    interactive,
  );
}

function normalizeInstallChoiceValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === true) {
    return "skip";
  }
  const normalized = String(value).toLowerCase();
  if (["pnpm", "npm", "yarn", "bun", "skip"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "auto") {
    return "auto";
  }
  return "skip";
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
      `[warn] package.json not found at ${packageJsonPath}. Skipping dependency injection.`,
    );
    return;
  }
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  pkg.dependencies = pkg.dependencies ?? {};
  let changed = false;
  deps.forEach((dep) => {
    if (!pkg.dependencies[dep]) {
      pkg.dependencies[dep] = DEP_VERSION_OVERRIDES[dep] ?? "latest";
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

async function scaffoldQueueTemplate({ serverDirAbs, force }) {
  const servicesDir = path.join(serverDirAbs, "services");
  const queuesDir = path.join(serverDirAbs, "queues");
  const workersDir = path.join(serverDirAbs, "workers");

  await ensureDir(servicesDir);
  await ensureDir(queuesDir);
  await ensureDir(workersDir);

  await writeFile(path.join(servicesDir, "queue.service.ts"), getQueueServiceTemplate(), force);

  await writeFile(path.join(queuesDir, "email.queue.ts"), getQueueExampleTemplate(), force);

  await writeFile(path.join(workersDir, "email.worker.ts"), getQueueWorkerTemplate(), force);

  await writeFile(path.join(workersDir, "index.ts"), getQueueWorkerIndexTemplate(), force);

  console.log("[queue] BullMQ scaffolding created");
}

async function scaffoldCacheTemplate({ serverDirAbs, force, provider }) {
  const cacheDir = path.join(serverDirAbs, "services", "cache");
  await ensureDir(cacheDir);
  const filePath = path.join(cacheDir, "cache.service.ts");
  await writeFile(filePath, getCacheServiceTemplate(provider), force);
  console.log(`[cache] ${provider} cache service created`);
}

async function scaffoldAuthTemplate({ authRouteFile, authServiceFile, force }) {
  await ensureDir(path.dirname(authServiceFile));
  await writeFile(authServiceFile, getBetterAuthServiceTemplate(), force);
  const authImportPath = toImportPath(path.relative(path.dirname(authRouteFile), authServiceFile));
  await ensureDir(path.dirname(authRouteFile));
  await writeFile(authRouteFile, getBetterAuthRouteTemplate(authImportPath), force);
  console.log("[auth] Better Auth bridge created");
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

async function scaffoldOrm({ projectRoot, serverDirAbs, force, choice }) {
  if (choice.orm === "prisma") {
    await scaffoldPrisma(projectRoot, choice.db, force);
    await ensureDir(path.join(serverDirAbs, "services"));
    await writeFile(
      path.join(serverDirAbs, "services", "database.ts"),
      getPrismaServiceTemplate(),
      force,
    );
  } else if (choice.orm === "drizzle") {
    await scaffoldDrizzle(projectRoot, serverDirAbs, choice.db, force);
  }

  await writeFile(path.join(serverDirAbs, "context.ts"), getContextTemplate(choice.orm), force);
}

async function printQueueStats({ redisUrl, projectRoot, serverDir }) {
  try {
    const { Queue } = await import("bullmq");
    const IORedis = (await import("ioredis")).default;
    const connection = redisUrl
      ? new IORedis(redisUrl)
      : new IORedis({
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
        "delayed",
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
    console.error(
      "Failed to fetch queue status. Ensure bullmq/ioredis are installed.",
      error.message ?? error,
    );
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
  } catch (_error) {
    console.error("ioredis is required for this command. Install it in the current project.");
    return null;
  }
}

async function scaffoldMcpTemplate({ serverDirAbs, force }) {
  const mcpServiceDir = path.join(serverDirAbs, "services", "mcp");
  const mcpFeatureDir = path.join(serverDirAbs, "features", "mcp");
  const toolsDir = path.join(mcpFeatureDir, "tools");
  await ensureDir(mcpServiceDir);
  await ensureDir(mcpFeatureDir);
  await ensureDir(toolsDir);

  await writeFile(path.join(mcpServiceDir, "mcp.service.ts"), getMcpServiceTemplate(), force);

  await writeFile(path.join(mcpServiceDir, "server.ts"), getMcpServerEntryTemplate(), force);

  await writeFile(path.join(toolsDir, "ping.tool.ts"), getMcpToolTemplate("ping"), force);

  const toolsIndexFile = path.join(toolsDir, "index.ts");
  await writeFile(toolsIndexFile, getMcpToolsIndexTemplate(), force);
  await linkMcpTool(toolsIndexFile, "ping");

  const routesFile = path.join(mcpFeatureDir, "routes.ts");
  await writeFile(routesFile, getMcpRoutesTemplate(), force);

  const masterRoutesFile = path.join(serverDirAbs, "routes", "index.ts");
  await injectFeatureImport(masterRoutesFile, "mcp");

  console.log("[mcp] MCP server scaffolding created");
}

async function scaffoldDockerTemplate({ projectRoot, force }) {
  await writeFile(path.join(projectRoot, "docker-compose.yml"), getDockerComposeTemplate(), force);

  await writeFile(path.join(projectRoot, "Dockerfile"), getDockerfileTemplate(), force);

  await writeFile(path.join(projectRoot, "Dockerfile.mcp"), getDockerfileMcpTemplate(), force);

  await writeFile(path.join(projectRoot, ".dockerignore"), getDockerIgnoreTemplate(), false);

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
    // Upstash provider uses native fetch, no extra imports required.
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
  private readonly url: string;
  private readonly token: string;

  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error("UPSTASH credentials are required when CACHE_PROVIDER=upstash");
    }
    this.url = url.endsWith("/") ? url.slice(0, -1) : url;
    this.token = token;
  }

  private async request<T>(command: string, ...args: (string | number)[]) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: \
          \`Bearer \${this.token}\`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([command, ...args]),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(\`[upstash] \${command} failed (\${response.status}): \${text}\`);
    }

    const payload = (await response.json()) as [T, unknown] | { result?: T; error?: unknown };
    if (Array.isArray(payload)) {
      return payload[0];
    }
    if (payload.error) {
      throw new Error(\`[upstash] \${command} error: \${JSON.stringify(payload.error)}\`);
    }
    return payload.result as T;
  }

  async get(key: string) {
    const value = await this.request<string | null>("GET", key);
    return value ? JSON.parse(value) : null;
  }

  async set(key: string, value: unknown, ttl?: number) {
    const payload = JSON.stringify(value);
    if (ttl) {
      await this.request("SET", key, payload, "EX", ttl);
    } else {
      await this.request("SET", key, payload);
    }
  }

  async delete(key: string) {
    await this.request("DEL", key);
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
  return `import { Queue, Worker, type JobsOptions, type QueueOptions, type WorkerOptions, type Job } from "bullmq";
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

    this.queues.set(name, queue);
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
      console.log("[queue:" + name + "] job " + job.id + " completed");
    });

    worker.on("failed", (job, error) => {
      console.error("[queue:" + name + "] job " + (job?.id ?? "unknown") + " failed", error);
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
    console.log("[worker] sending email to " + to + ": " + subject);
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
    console.log("[${name} worker] received job " + job.name, job.data);
  return { handledAt: Date.now() };
});
`;
}

async function scaffoldPrisma(projectRoot, db, force) {
  const prismaDir = path.join(projectRoot, "prisma");
  await ensureDir(prismaDir);
  await writeFile(path.join(prismaDir, "schema.prisma"), getPrismaSchemaTemplate(db), force);

  const envPath = path.join(projectRoot, ".env");
  if (!(await fileExists(envPath))) {
    await fs.writeFile(envPath, getPrismaEnvTemplate(db), "utf8");
  }
}

async function scaffoldDrizzle(projectRoot, serverDirAbs, db, force) {
  const drizzleDir = path.join(serverDirAbs, "services", "drizzle");
  await ensureDir(drizzleDir);
  await writeFile(path.join(drizzleDir, "schema.ts"), getDrizzleSchemaTemplate(), force);
  await writeFile(path.join(drizzleDir, "client.ts"), getDrizzleClientTemplate(db), force);
  await writeFile(path.join(projectRoot, "drizzle.config.ts"), getDrizzleConfigTemplate(db), force);
  const envPath = path.join(projectRoot, ".env");
  if (!(await fileExists(envPath))) {
    await fs.writeFile(envPath, getDrizzleEnvTemplate(db), "utf8");
  }
}

function getMcpServiceTemplate() {
  return `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShape } from "zod";

type TextContent = {
  type: "text";
  text: string;
  _meta?: Record<string, unknown>;
};

type ToolCallResult = {
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

type ToolConfig = {
  name: string;
  description?: string;
  inputSchema?: ZodRawShape;
  handler: (input: unknown) => Promise<unknown>;
};

export class FastNextMcpServer {
  private readonly server = new McpServer({
    name: "fast-next-mcp",
    version: "0.1.0",
  });

  private readonly tools = new Map<string, ToolConfig>();

  registerTool(tool: ToolConfig) {
    if (this.tools.has(tool.name)) {
      return;
    }
    this.tools.set(tool.name, tool);
    this.server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown) => normalizeToolResult(await tool.handler(args))
    );
  }

  listTools() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  getTool(name: string) {
    return this.tools.get(name);
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    await transport.start();
    console.log("[mcp] stdio transport started");
  }
}

export const mcpServer = new FastNextMcpServer();

function normalizeToolResult(result: unknown): ToolCallResult {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown }).content)
  ) {
    const cast = result as ToolCallResult;
    return {
      ...cast,
      structuredContent: cast.structuredContent ?? {},
    };
  }

  const text =
    typeof result === "string"
      ? result
      : JSON.stringify(result ?? { message: "ok" }, null, 2);

  const structuredContent =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : { value: result ?? null };

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent,
  };
}
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
  const description =
    name === "ping"
      ? "Return a pong response to test connectivity"
      : `Tool '${name}' generated via CLI`;
  return `import { mcpServer } from "@/server/services/mcp/mcp.service";
import { z } from "zod";

const payloadSchema = z
  .record(z.unknown())
  .optional()
  .describe("Tool-specific payload");

mcpServer.registerTool({
  name: "${name}",
  description: "${description}",
  inputSchema: {
    payload: payloadSchema,
  },
  handler: async (input: unknown) => {
    const parsed = z
      .object({
        payload: payloadSchema,
      })
      .safeParse(input);

    const payload = parsed.success ? (parsed.data.payload ?? null) : null;

    return {
      content: [
        {
          type: "text",
          text: "pong",
        },
      ],
      structuredContent: {
        tool: "${name}",
        echo: payload,
        timestamp: Date.now(),
      },
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
`;
}

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
  const matches = [...content.matchAll(/import "\.\/(.+?)\.tool";/g)].map((match) => match[1]);
  if (!matches.length) {
    console.log("No MCP tools registered yet.");
    return;
  }
  console.log("Registered MCP tools:\n");
  matches.forEach((tool) => {
    console.log(`- ${tool}`);
  });
}

function getPrismaSchemaTemplate(db) {
  const provider = db === "mysql" ? "mysql" : db === "postgres" ? "postgresql" : "sqlite";
  const urlComment = provider === "sqlite" ? "file:./dev.db" : 'env("DATABASE_URL")';
  return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  url      = ${provider === "sqlite" ? `"${urlComment}"` : urlComment}
}

model Example {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
}
`;
}

function getPrismaEnvTemplate(db) {
  if (db === "sqlite") {
    return `DATABASE_URL="file:./dev.db"\n`;
  }
  if (db === "postgres") {
    return `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fast_next"\n`;
  }
  return `DATABASE_URL="mysql://root:password@localhost:3306/fast_next"\n`;
}

function getPrismaServiceTemplate() {
  return `import { PrismaClient } from "@prisma/client";

export const database = new PrismaClient();
`;
}

function getDrizzleSchemaTemplate() {
  return `import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const example = sqliteTable("example", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
});
`;
}

function getDrizzleClientTemplate(db) {
  const importLine =
    db === "sqlite"
      ? 'import Database from "better-sqlite3";\nimport { drizzle } from "drizzle-orm/better-sqlite3";'
      : db === "postgres"
        ? 'import { drizzle, type NodePgClient } from "drizzle-orm/node-postgres";'
        : 'import mysql from "mysql2/promise";\nimport { drizzle } from "drizzle-orm/mysql2";';
  return `${importLine}

export async function getDatabase() {
  ${db === "sqlite" ? "return drizzle(new Database('sqlite.db'));" : db === "postgres" ? "const { Pool } = await import('pg');\n  const pool = new Pool({ connectionString: process.env.DATABASE_URL });\n  return drizzle(pool as unknown as NodePgClient);" : "const pool = await mysql.createPool({ uri: process.env.DATABASE_URL });\n  return drizzle(pool);"}
}
`;
}

function getDrizzleConfigTemplate(db) {
  const out = db === "sqlite" ? "./drizzle" : "./drizzle";
  return `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/services/drizzle/schema.ts",
  out: "${out}",
  dialect: "${db === "sqlite" ? "sqlite" : db === "postgres" ? "postgresql" : "mysql"}",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
`;
}

function getDrizzleEnvTemplate(db) {
  if (db === "sqlite") {
    return `DATABASE_URL="file:./sqlite.db"\n`;
  }
  if (db === "postgres") {
    return `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fast_next"\n`;
  }
  return `DATABASE_URL="mysql://root:password@localhost:3306/fast_next"\n`;
}

function getContextTemplate(orm) {
  if (orm === "prisma") {
    return `import { database } from "./services/database";

export function createAppContext() {
  return { database };
}

export type AppContext = ReturnType<typeof createAppContext>;
`;
  }
  if (orm === "drizzle") {
    return `import { getDatabase } from "./services/drizzle/client";

export async function createAppContext() {
  const database = await getDatabase();
  return { database };
}

export type AppContext = Awaited<ReturnType<typeof createAppContext>>;
`;
  }
  return `export function createAppContext() {
  return {};
}

export type AppContext = ReturnType<typeof createAppContext>;
`;
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
