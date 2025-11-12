# Fast Next – Fastify × Next.js Vertical Slice

This repo transforms the default Turborepo starter into an opinionated playground for building Igniter.js‑style DX on top of Fastify and Next.js 16. The current milestone delivers a **single-source-of-truth vertical slice**:

1. Define routes once with Zod schemas.  
2. Serve them over HTTP through Next’s App Router.  
3. Call them directly on the server without touching the network.

Everything lives in a single monorepo so you can evolve the DX in lockstep.

---

## Repo Map

| Path | Description |
| --- | --- |
| `apps/fast-next-playground` | Canonical Next.js 16 + Fastify playground. Ships the new `src/server/http` layout, `/demo` showcase, MCP, cache, etc. |
| `apps/docs` | Fumadocs-powered reference site (quickstart, router guide, CLI reference). |
| `docs/fast-next` | MDX documentation for this stack (introduction, quickstart, architecture, feature guides). |
| `packages/create-fast-next` | CLI that scaffolds Fast Next projects (new server/http structure, optional auth/cache/queue/MCP/Docker modules). |
| `packages/fastify-next-adapter` | Bridges `NextRequest` to `fastify.inject` (headers, body, binary safe). |
| `packages/fastify-app-factory` | Singleton Fastify factory with plugin hooks + dev-safe global cache. |
| `packages/fastify-zod-router` | Router builder that captures method/path/schema metadata and emits JSON Schema for Fastify validation. |
| `packages/fastify-server-caller` | Wraps a built router so you can invoke handlers directly (no HTTP). |
| `packages/ui`, `packages/eslint-config`, `packages/typescript-config` | Shared UI + tooling from the starter (still available). |

---

## Prerequisites

- Node.js ≥ 18.18 (Next.js 16 requires ≥ 18, Fastify 5 prefers ≥ 18).
- pnpm 9 (the repo is pinned to `pnpm@9.0.0` in `packageManager`).
- macOS/Linux/WSL terminal with `bash`/`zsh`. (Examples use `pnpm`.)

Install dependencies once:

```bash
pnpm install
```

---

## Everyday Commands

```bash
# Run everything in dev mode (Turbo fanning out to all packages)
pnpm dev

# Just run the playground app on port 3000
pnpm --filter fast-next-playground dev

# Type-check all workspaces
pnpm check-types

# Lint everything
pnpm lint
```

### Hitting the APIs

After `pnpm --filter fast-next-playground dev`:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/users/1
```

Both go through the adapter → Fastify route you author in one place.

---

## How the Pieces Fit Together

### 1. Author routes with Zod once

Example: `apps/fast-next-playground/src/server/http/routes/projects/list-projects.ts`

```ts
import { createRoute } from "@fast-next/fastify-router";
import type { TypedRouteHandler } from "@fast-next/fastify-zod-router";
import { z } from "zod";

import { listProjects, projectSchema } from "./store";

const schema = {
  response: z.object({
    items: z.array(projectSchema),
  }),
} as const;

export const listProjectsRoute = createRoute({
  method: "GET",
  path: "/projects",
  resource: "projects",
  operation: "list",
  schema,
  handler: (async () => ({ items: listProjects() })) satisfies TypedRouteHandler<typeof schema>,
});
```

- Each feature owns `schemas.ts`, `service.ts`, and `routes.ts` inside `src/server/http/routes/<feature>/`.  
- `createRoute` keeps literal `resource` + `operation` names so `api.projects.list.*` autocompletes automatically.  
- Zod schemas feed Fastify validation and typed handlers in one place.

### 2. Register feature routers once

`apps/fast-next-playground/src/server/http/routes/index.ts`

```ts
import { systemRoutes } from "./system";
import { projectRoutes } from "./projects";
import { McpRoutes } from "../../features/mcp/routes";

export const serverRoutes = [
  ...systemRoutes,
  ...projectRoutes,
  ...McpRoutes,
] as const;

export async function registerHttpRoutes(app: FastifyInstance) {
  await registerFastifyRoutes(app, serverRoutes);
}
```

FAST_NEXT markers keep this file tidy when the CLI inserts new imports/spreads.

### 3. Mount Fastify + middleware

`apps/fast-next-playground/src/server/http/server.ts`

```ts
export async function registerHttpServer(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  await app.register(fastifyCors);
  await registerHttpRoutes(app);
}
```

`src/server/fastify-app.ts` just forwards to `registerHttpServer`, keeping the singleton factory clean.

### 4. Surface everything through Next’s App Router

Catch-all route: `apps/fast-next-playground/app/api/[...fastify]/route.ts`

```ts
const app = await getAppInstance();
return handleNextRequest(req, app);
```

- `handleNextRequest` (adapter package) maps `NextRequest` → `fastify.inject`.  
- Binary bodies, multi-value headers (`Set-Cookie`), and base-path stripping (`/api`) are handled for you.

### 5. Call the same handlers directly

`apps/fast-next-playground/src/server/api.ts`

```ts
const builtRouter = {
  routes: serverRoutes,
  register: registerHttpRoutes,
} satisfies BuiltRouter<typeof serverRoutes>;

export const serverCaller = createServerCaller(builtRouter);
const typedServerRoutes = serverRoutes as readonly FastifyRouteDefinition[];
const typedServerCaller = serverCaller as FastifyCaller<typeof typedServerRoutes>;
export const api = createServerClient(typedServerRoutes, typedServerCaller);
export const queryClient = new FastifyQueryClient();
```

- `api.system.health.request()` and `api.projects.list.request()` run handlers without touching the network (great for Server Components, jobs, tests).  
- The generated browser client (`@/client/api`) provides `useQuery`/`useMutation` hooks backed by the same metadata.  
- Prefer raw paths? `api.routes["/projects"].get.request()` is still there.

### 6. Showcase in `/demo`

`apps/fast-next-playground/app/demo/page.tsx` renders both sides:

- The **server** panel awaits `api.system.health.request()` + `api.projects.list.request()` inside an async Server Component to prove everything stays in-process.  
- The **client** panel imports the browser client, uses `useQuery`/`useMutation`, and shares a `FastifyQueryClient` cache so invalidations rehydrate automatically.

---

## Package Reference

### `@fast-next/fastify-next-adapter`

- `handleNextRequest(req, fastifyApp, { apiBasePath?: string })`
- `convertNextHeaders`, `convertToNextResponse` helpers (exported for testing/extensibility).
- Handles payload buffering for all HTTP verbs and normalizes multi-value headers.

### `@fast-next/fastify-app-factory`

- `getFastifyApp(config)` returns a singleton Fastify instance with optional plugins/hook.
- `resetFastifyApp()` and `getFastifyAppSync()` exist for tests or tooling.
- Stores the instance on a `globalThis` key during development to avoid HMR leaks.

### `@fast-next/fastify-zod-router`

- `createRouter()` fluent builder with `.route/.get/.post/...`.
- Returns `{ routes, register }` so you can inspect metadata or auto-register.
- Schema helpers infer handler types and emit JSON Schema for Fastify validation responses (single schema or per-status map).

### `@fast-next/fastify-server-caller`

- `createServerCaller(router)` → `caller(method, path, options?)`.
- `options` lets you pass `params`, `body`, `query`, `headers`, plus arbitrary `context` you might want to surface to handlers later.
- Useful inside Server Components, Server Actions, background jobs, or tests where you want the handler guarantee without HTTP overhead.

### CLI (`create-fast-next`)

- `pnpm dlx create-fast-next init .` scaffolds the catch-all API route plus the full `src/server/http/{routes,server}` layout, MCP skeleton, cache service, and `src/server/api.ts` helpers.
- `pnpm dlx create-fast-next feature analytics` drops a new `src/server/http/routes/analytics` folder (schemas/service/routes) and wires it into `registerHttpRoutes` via FAST_NEXT markers.
- Add `--install auto`, `--with-queue`, `--with-cache redis|upstash|memory`, `--with-mcp`, or `--with-docker` to tailor the scaffolded stack. Use `--app/--server/--api` to point at custom directories.
- The CLI also patches `tsconfig.json` to map `@/*` to both `src/*` and project root so the generated alias imports resolve instantly.
- See `docs/fast-next/cli.mdx` for the full option list.

---

## Building Your Own Feature

1. **Add schemas/handlers** inside `src/server/http/routes/<feature>/` (e.g. `schemas.ts`, `service.ts`, `routes.ts`, and an `index.ts` that exports `const <feature>Routes = [...]`).
2. **Re-export** the feature from `src/server/http/routes/index.ts` (FAST_NEXT markers mean `create-fast-next feature <name>` does this automatically).
3. **Expose via HTTP** automatically—the catch-all route just sees the Fastify app, so no extra Next plumbing is needed.
4. **Consume on the server** with the generated `api` helpers or the browser hooks. Because everything flows from the same `serverRoutes` metadata, future client codegen is trivial.

Pro tip: keep Zod schemas colocated with business logic (e.g., `schemas.ts`, `service.ts`) and import them into the router. That makes it trivial to reuse the same schema for form validation or client codegen.

---

## Testing the Slice

1. `pnpm --filter fast-next-playground dev`.
2. Visit `http://localhost:3000/` → the hero section should display the featured user fetched through the server API client (built on top of the server caller).
3. Hit `http://localhost:3000/api/health` and `/api/users/<id>` to verify the adapter path.
4. Run `pnpm --filter @fast-next/fastify-zod-router check-types` or `pnpm --filter @fast-next/fastify-server-caller check-types` when editing the packages—they’re lightweight TypeScript projects so the command finishes quickly.

If something breaks:

- Adapter issues → check `packages/fastify-next-adapter/src/handle-next-request.ts`.
- Fastify lifecycle issues → `packages/fastify-app-factory`.
- Type inference problems → `packages/fastify-zod-router/src/types.ts`.
- Server caller behavior → `packages/fastify-server-caller/src/create-server-caller.ts`.

## Documentation Hub

The new docs live in `docs/fast-next`. Start with:

- `introduction.mdx` – goals and package overview
- `quickstart.mdx` – setup steps, commands, HTTP + server caller smoke tests
- `architecture.mdx` – request flow, adapters, lifecycle
- `feature-guide.mdx` – step-by-step recipe for shipping a new feature
- `router.mdx`, `adapter.mdx`, `server-caller.mdx` – deep dives into each package

You can render these MDX files in any doc site (e.g., wire them into `apps/docs`) or just read them locally while building features.

---

## Roadmap Preview

Only the foundational vertical slice (Phases 1–3 from `PLAN.md`) is complete. Upcoming work includes client generation, feature loaders, CLI scaffolding, auth/doc plugins, and a full DX polish pass. Contributions or experiments in those areas are welcome—just keep routes and schemas flowing through the packages above so everything stays type-safe.

Happy hacking! 🎯🚀
