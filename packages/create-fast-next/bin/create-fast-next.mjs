#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const HELP = `create-fast-next

Usage:
  create-fast-next init [projectDir] [options]
  create-fast-next feature <name> [options]

Options:
  --app <path>       Relative path to the Next.js app directory (default: app)
  --server <path>    Relative path to the server folder (default: src/server)
  --api <path>       Relative path to the API catch-all folder (default: <app>/api/[...fastify])
  --force            Overwrite existing files when scaffolding
  --dir <path>       Base directory for feature scaffolding (default: .)
  -h, --help         Show this message
`;

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
  const projectRoot = path.resolve(process.cwd(), options._[0] ?? ".");
  const appDir = options.app ?? "app";
  const serverDir = options.server ?? path.join("src", "server");
  const apiDir = options.api ?? path.join(appDir, "api", "[...fastify]");
  const force = Boolean(options.force);

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

  console.log("\nScaffold complete. Next steps:\n");
  console.log("1. Install dependencies:");
  console.log(
    "   pnpm add fastify zod @fast-next/fastify-app-factory @fast-next/fastify-next-adapter @fast-next/fastify-router @fast-next/fastify-zod-router @fast-next/fastify-server-caller @fast-next/fastify-server-client @fast-next/fastify-browser-client @fast-next/fastify-query-client"
  );
  console.log("2. Ensure your tsconfig.json maps '@/*' to your source directory if you plan to use alias imports.");
  console.log("3. Start Next.js with 'pnpm dev' and hit /api/health to verify the bridge.");
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
  const featureFile = path.join(featureDir, "routes.ts");

  await ensureDir(featureDir);
  await writeFile(featureFile, getFeatureTemplate(featureName), Boolean(options.force));
  await injectFeatureImport(routesFile, featureName);
  console.log(`Feature '${featureName}' scaffolded. Remember to visit the generated routes.`);
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

function getFeatureTemplate(name) {
  const pascal = toPascalCase(name);
  const exportName = `${pascal}Routes`;
  const camel = camelCase(name);
  const dashed = dashCase(name);
  const listSchemaName = `${camel}ListSchema`;
  return `import { createRoute, type FastifyRouteDefinition } from "@fast-next/fastify-router";
import type { TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";

const ${camel}Schema = z.object({
  id: z.string(),
  name: z.string(),
});

const ${listSchemaName} = {
  response: z.object({
    items: z.array(${camel}Schema),
  }),
} as const;

export const ${exportName} = [
  createRoute({
    method: "GET",
    path: "/${dashed}",
    resource: "${dashed}",
    operation: "list",
    schema: ${listSchemaName},
    handler: (async () => ({ items: [] })) satisfies TypedRouteHandler<typeof ${listSchemaName}>,
  }),
] as const satisfies readonly FastifyRouteDefinition[];
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

await main();
