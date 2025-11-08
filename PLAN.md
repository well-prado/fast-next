# 🚀 Fastify-Next Integration Framework: Implementation Roadmap

Based on your goal to replicate Igniter.js's powerful DX with Fastify in a standard Next.js app, here's your **prioritized, actionable roadmap**:

---

## 🎯 **Strategic Overview**

You're building a framework that gives you:

- **Single source of truth** (Fastify routes with Zod schemas)
- **Three consumption modes**: HTTP API, typed client, server-side direct calls
- **Feature-based architecture** with auto-registration
- **Full type safety** from backend to frontend

**Key Insight**: Start with the "vertical slice" (Phases 1-3) to prove the concept, then expand horizontally with DX improvements.

---

## 📅 **Phase 1: Core Foundation (Week 1-2)** ⭐ START HERE

### **Package 1: `@your-org/fastify-next-adapter`**

**Why first?** This is your bridge—nothing works without it.

**Implementation Priority:**

```typescript
// 1. Create src/adapter/inject-bridge.ts
export async function handleNextRequest(
  req: NextRequest,
  fastifyApp: FastifyInstance
): Promise<NextResponse> {
  // Convert Next request to Fastify inject options
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";

  const payload = ["GET", "HEAD"].includes(req.method)
    ? undefined
    : await req.arrayBuffer();

  const response = await fastifyApp.inject({
    method: req.method,
    url: path + url.search,
    headers: convertHeaders(req.headers),
    payload: payload ? Buffer.from(payload) : undefined,
  });

  return convertToNextResponse(response);
}
```

**Week 1 Checklist:**

- [ ] Create header conversion utilities (handle multiple `Set-Cookie`)
- [ ] Build request/response mappers
- [ ] Handle binary/multipart bodies correctly
- [ ] Add comprehensive error mapping
- [ ] Write tests for all HTTP methods

**Week 2 Checklist:**

- [ ] Create CLI to scaffold `app/api/[...all]/route.ts`
- [ ] Add dev-mode request logging
- [ ] Document runtime requirements
- [ ] Publish v0.1.0-alpha

**Deliverable:** Working `/api/*` → Fastify routing

---

### **Package 2: `@your-org/fastify-app-factory`**

**Week 2 Implementation:**

```typescript
// src/factory/create-app.ts
import Fastify from "fastify";

let _instance: FastifyInstance | null = null;

export async function getFastifyApp(
  config?: FastifyAppConfig
): Promise<FastifyInstance> {
  if (_instance) return _instance;

  const app = Fastify({
    logger: config?.logger ?? process.env.NODE_ENV === "development",
  });

  // Register base plugins
  if (config?.cors) await app.register(cors, config.cors);

  // Hook for custom plugin registration
  if (config?.plugins) {
    for (const plugin of config.plugins) {
      await app.register(plugin);
    }
  }

  _instance = app;
  return app;
}

// HMR safety for dev
if (process.env.NODE_ENV === "development" && module.hot) {
  module.hot.dispose(() => {
    _instance?.close();
    _instance = null;
  });
}
```

**Deliverable:** Singleton Fastify instance management

---

## 📅 **Phase 2: Type Safety (Week 3-4)** ⭐ CRITICAL FOR DX

### **Package 3: `@your-org/fastify-zod-router`**

**This is your Igniter.js `AppRouter` equivalent—the heart of the system.**

**Week 3 Implementation:**

```typescript
// src/router/create-router.ts
import { z } from "zod";
import { FastifyInstance } from "fastify";

export function createRouter() {
  const routes: Route[] = [];

  const builder = {
    route<
      TPath extends string,
      TMethod extends HttpMethod,
      TSchema extends RouteSchema,
    >(method: TMethod, path: TPath, config: RouteConfig<TSchema>) {
      routes.push({ method, path, config });
      return builder;
    },

    get: <P extends string, S extends RouteSchema>(
      path: P,
      config: RouteConfig<S>
    ) => builder.route("GET", path, config),

    post: <P extends string, S extends RouteSchema>(
      path: P,
      config: RouteConfig<S>
    ) => builder.route("POST", path, config),

    // ... other methods

    build() {
      return {
        routes,
        register: (app: FastifyInstance, opts?: RouteOptions) => {
          routes.forEach((route) => {
            app.route({
              method: route.method,
              url: opts?.prefix ? `${opts.prefix}${route.path}` : route.path,
              schema: convertZodToJsonSchema(route.config.schema),
              handler: route.config.handler,
            });
          });
        },
      };
    },
  };

  return builder;
}
```

**Usage Example:**

```typescript
// src/server/features/users/routes.ts
export const userRouter = createRouter()
  .get("/users/:id", {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: z.object({
        id: z.string(),
        email: z.string().email(),
        name: z.string(),
      }),
    },
    handler: async (req, reply) => {
      // req.params is fully typed!
      const user = await getUser(req.params.id);
      return user; // reply validates against schema
    },
  })
  .post("/users", {
    schema: {
      body: CreateUserSchema,
      response: UserSchema,
    },
    handler: async (req, reply) => {
      return createUser(req.body); // typed!
    },
  });
```

**Week 4 Checklist:**

- [ ] Implement type inference from Zod schemas
- [ ] Add middleware/hooks per route
- [ ] Support nested routers
- [ ] Extract route types for client generation
- [ ] Write comprehensive tests
- [ ] Document patterns

**Deliverable:** Type-safe router builder with Zod validation

---

## 📅 **Phase 3: Server-Side Calling (Week 5)** ⭐ IGNITER'S KILLER FEATURE

### **Package 5: `@your-org/fastify-server-caller`**

**This eliminates HTTP overhead for Server Components/Actions.**

**Implementation Strategy:**

```typescript
// src/server/caller/create-caller.ts
export function createServerCaller<TRouter extends Router>(
  router: TRouter,
  context: CallerContext
) {
  const caller = {} as CallerProxy<TRouter>;

  for (const route of router.routes) {
    const [method, ...pathParts] = route.path.split("/").filter(Boolean);

    // Build nested object structure
    // e.g., "POST /users" → caller.users.create()
    const handler = async (...args: any[]) => {
      // Validate input with Zod schema
      const validated = route.config.schema.body?.parse(args[0]);

      // Call service layer directly (no HTTP!)
      return route.config.handler({
        body: validated,
        user: context.user, // Preserve auth context
        params: extractParams(route.path, args),
      });
    };

    // Nest the handler in the caller object
    setNestedProperty(caller, route.path, handler);
  }

  return caller;
}
```

**Usage in Server Component:**

```typescript
// app/users/[id]/page.tsx
import { serverCaller } from '@/server/caller';

export default async function UserPage({ params }) {
  // No HTTP call! Direct service invocation
  const user = await serverCaller.users.get(params.id);

  return <UserProfile user={user} />;
}
```

**Week 5 Checklist:**

- [ ] Build caller proxy with nested structure
- [ ] Preserve authentication context
- [ ] Share Zod validation with HTTP layer
- [ ] Add error handling (same as HTTP)
- [ ] Type inference from router
- [ ] Document when to use vs HTTP

**Deliverable:** Direct server-side calling with full type safety

---

## 📅 **Phase 4: Client Generation (Week 6)**

### **Package 4: `@your-org/fastify-client-generator`**

**Generate typed fetch clients from your router definitions.**

```typescript
// CLI: generate-client.ts
export async function generateClient(routerPath: string) {
  const router = await import(routerPath);
  const routes = extractRoutes(router);

  const clientCode = `
    export const api = {
      ${routes.map((route) => generateClientMethod(route)).join(",\n")}
    };
  `;

  await writeFile("src/client/api.ts", clientCode);
}

function generateClientMethod(route: Route) {
  return `
    ${route.name}: async (${route.params}) => {
      const res = await fetch('/api${route.path}', {
        method: '${route.method}',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(${route.bodyParam}),
      });
      if (!res.ok) throw new Error('Request failed');
      return res.json() as Promise<${route.responseType}>;
    }
  `;
}
```

**Generated Client Usage:**

```tsx
// Client Component
"use client";
import { api } from "@/client/api";
import { useQuery } from "@tanstack/react-query";

export function UserProfile({ id }: { id: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["user", id],
    queryFn: () => api.users.get(id), // Fully typed!
  });

  if (isLoading) return <Loading />;
  return <div>{data.name}</div>;
}
```

**Deliverable:** CLI that generates typed fetch client

---

## 📅 **Phase 5: Feature Auto-Loading (Week 7)**

### **Package 6: `@your-org/fastify-feature-loader`**

**Convention over configuration—auto-register all features.**

```typescript
// src/loader/feature-loader.ts
import { glob } from "glob";

export async function loadFeatures(
  app: FastifyInstance,
  options: LoaderOptions
) {
  const routeFiles = await glob(`${options.directory}/**/routes.{ts,js}`, {
    absolute: true,
  });

  for (const file of routeFiles) {
    const module = await import(file);
    const router = module.default || module.router;

    if (!router?.routes) {
      console.warn(`⚠️  ${file} doesn't export a router`);
      continue;
    }

    // Extract feature name from path
    // e.g., features/users/routes.ts → prefix: /users
    const featureName = extractFeatureName(file, options.directory);

    router.register(app, { prefix: `/${featureName}` });
    console.log(`✅ Loaded feature: ${featureName}`);
  }
}
```

**File Structure:**

```
src/server/features/
├── users/
│   ├── routes.ts      # exports userRouter
│   ├── schemas.ts     # exports Zod schemas
│   ├── service.ts     # exports business logic
│   └── types.ts       # exports TypeScript types
├── posts/
│   ├── routes.ts
│   ├── schemas.ts
│   └── service.ts
```

**In your Fastify app:**

```typescript
// src/server/fastify-app.ts
import { loadFeatures } from "@your-org/fastify-feature-loader";

export async function getFastifyApp() {
  if (_app) return _app;

  const app = Fastify();

  // Auto-load all features
  await loadFeatures(app, {
    directory: path.join(process.cwd(), "src/server/features"),
  });

  _app = app;
  return app;
}
```

**Deliverable:** Auto-discovery and registration of feature routes

---

## 📅 **Phase 6: DX Enhancements (Week 8-9)**

### Quick Wins:

1. **Auth Plugin** - `@your-org/fastify-auth-plugin`
   - JWT/session strategies
   - `request.user` decoration
   - Route guards

2. **API Docs** - `@your-org/fastify-docs-plugin`
   - Auto-generate from Zod schemas
   - Swagger UI at `/api/docs`

3. **CLI Scaffolding** - `create-fastify-next-app`
   - Interactive project generator
   - Feature scaffolding: `npx create-feature posts`

---

## 📅 **Phase 7: Polish (Week 10-12)**

- [ ] Comprehensive testing utilities
- [ ] Documentation site
- [ ] Migration guide from Igniter.js
- [ ] Video tutorials
- [ ] Reference app (build a real project)
- [ ] Performance benchmarking
- [ ] Community setup (Discord/GitHub)

---

## 🎯 **Your MVP (Weeks 1-5)**

**Focus on the vertical slice:**

1. ✅ Next → Fastify adapter (Phase 1)
2. ✅ Type-safe router with Zod (Phase 2)
3. ✅ Server-side caller (Phase 3)

**This gives you Igniter.js's core value:**

- Define once (Zod schema + handler)
- Use three ways (HTTP, client, server caller)
- Full type safety end-to-end

---

## 🚀 **Next Actions**

**This week:**

1. Set up monorepo structure (`pnpm` + workspaces)
2. Create Package 1 (`fastify-next-adapter`)
3. Build proof-of-concept: single route working through adapter

**Validation test:**

```typescript
// Can you do this?
const userRouter = createRouter().get("/users/:id", { schema, handler });

// HTTP: Works at /api/users/123
// Client: api.users.get('123') - typed
// Server: serverCaller.users.get('123') - typed, no HTTP
```

**Need help with:**

- Specific package implementation?
- Code templates?
- Architecture decisions?
- Testing strategy?

Let me know where you want to dive deeper! 🚀
