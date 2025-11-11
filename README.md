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
| `apps/web` | Next.js 16 app that mounts Fastify, exposes `/api/*`, and powers the production UI. |
| `apps/fast-next-playground` | Sandboxed Next.js app showcasing the Fastify bridge at `/demo` (async server component + client hooks) while leaving the default landing page untouched. |
| `apps/docs` | Placeholder Next.js app (unchanged from the starter). |
| `docs/fast-next` | MDX documentation for this stack (introduction, quickstart, architecture, feature guides). |
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

# Just run the web app on port 3000
pnpm --filter web dev

# Type-check all workspaces
pnpm check-types

# Lint everything
pnpm lint
```

### Hitting the APIs

After `pnpm --filter web dev`:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/users/1
```

Both go through the adapter → Fastify route you author in one place.

---

## How the Pieces Fit Together

### 1. Author routes with Zod once

Location: `apps/web/src/server/routes/index.ts`

```ts
export const coreRouter = createRouter()
  .get("/users/:id", {
    schema: {
      params: z.object({ id: z.string() }),
      response: {
        200: userSchema,
        404: z.object({ error: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const user = USERS.find((u) => u.id === request.params.id);
      if (!user) {
        reply.code(404);
        return { error: "User not found" };
      }
      return user;
    },
  })
  .build();
```

- `createRouter` stores method/path/schema metadata for every call.
- Zod schemas are converted to Fastify JSON Schema automatically.
- Handler types (params, body, reply) are inferred from the schema.

### 2. Register routes once

`apps/web/src/server/fastify-app.ts`

```ts
export function getAppInstance() {
  return getFastifyApp({
    configureApp: registerCoreRoutes, // loads the router above
  });
}
```

`registerCoreRoutes` simply does `await coreRouter.register(app);`.

### 3. Surface them through Next’s App Router

Catch-all route: `apps/web/app/api/[...fastify]/route.ts`

```ts
const app = await getAppInstance();
return handleNextRequest(req, app);
```

- `handleNextRequest` (adapter package) maps `NextRequest` → `fastify.inject`.
- Binary bodies, multi-value headers (`Set-Cookie`), and base-path stripping (`/api`) are handled for you.

### 4. Call the same handlers directly

`apps/web/src/server/api.ts`

```ts
export const serverCaller = createServerCaller(mergedRouter);

export const api = {
  call: serverCaller,
  routes: buildPathApi(mergedRouter.routes, serverCaller),
  ...buildMethodApi(mergedRouter.routes, serverCaller),
};

export const queryClient = new FastifyQueryClient(api);
```

The `api.get` / `api.post` objects are generated automatically from the router metadata, so every new Fastify route shows up as an ergonomic chain. Usage in any Server Component:

```ts
const user = await api.get.user.query({
  params: { id: "1" },
});

const projects = await api.get.projects.query();

// TanStack-style helper
const stats = await queryClient.fetchQuery("system", "health");
```

Prefer raw paths? `api.routes["/users/:id"].get(...)` is still available. Either way this never leaves the process: we fabricate a Fastify `request`/`reply`, run the handler, and return `{ statusCode, headers, body }`. Input/output types come from the same Zod schemas you already wrote, and the client advertises the available endpoints automatically.

### 5. Showcase in the UI

`apps/web/app/page.tsx` fetches data through `api.get.user.query` / `api.get.projects.query` so you can see the pattern end-to-end, and you can batch multiple calls with `queryClient.fetchMany([...])` when needed.

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

- `pnpm dlx create-fast-next init .` scaffolds the catch-all API route plus `src/server/{fastify-app,routes,api}.ts`.
- `pnpm dlx create-fast-next feature analytics` drops a new `src/server/features/analytics/routes.ts` file and wires it into the master `serverRoutes` array.
- Add `--install auto`, `--with-queue`, `--with-cache redis|upstash|memory`, `--with-mcp`, or `--with-docker` to tailor the scaffolded stack. Use `--app/--server/--api` to point at custom directories.
- See `docs/fast-next/cli.mdx` for the full option list.

---

## Building Your Own Feature

1. **Add schemas/handlers** in `apps/web/src/server/features/<feature>/routes.ts` (feel free to split files; then import/register in `registerCoreRoutes`).
2. **Re-export** the router or handlers for reuse (client generation, server caller, etc.).
3. **Expose via HTTP** automatically—no extra Next plumbing needed as long as the route lives under Fastify.
4. **Consume on the server** with the `api` helpers backed by `serverCaller`. If you need typed HTTP clients later, you already have the route metadata to generate them.

Pro tip: keep Zod schemas colocated with business logic (e.g., `schemas.ts`, `service.ts`) and import them into the router. That makes it trivial to reuse the same schema for form validation or client codegen.

---

## Testing the Slice

1. `pnpm --filter web dev`.
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
