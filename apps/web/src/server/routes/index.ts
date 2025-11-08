import type { FastifyInstance } from "fastify";
import {
  buildFastifySchema,
  type HttpMethod,
  type RouteDefinition,
  type RouteMeta,
  type RouteSchema,
  type TypedRouteHandler,
} from "@fast-next/fastify-zod-router";
import { z } from "zod";

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

const PROJECTS = [
  { id: "p1", name: "DX Overhaul", status: "active" },
  { id: "p2", name: "Edge API Gateway", status: "draft" },
  { id: "p3", name: "Realtime Sync", status: "archived" },
] as const;

type RouteDefinitionLiteral<
  TMethod extends HttpMethod,
  TPath extends string,
  TSchema extends RouteSchema,
  TResource extends string,
  TOperation extends string
> = RouteDefinition<TSchema, RouteMeta<TResource, TOperation>> & {
  readonly method: TMethod;
  readonly path: TPath;
  readonly config: {
    readonly schema: TSchema;
    readonly handler: TypedRouteHandler<TSchema>;
    readonly meta: RouteMeta<TResource, TOperation>;
  };
};

function createRoute<
  TMethod extends HttpMethod,
  TPath extends string,
  TSchema extends RouteSchema,
  TResource extends string,
  TOperation extends string
>(config: {
  method: TMethod;
  path: TPath;
  resource: TResource;
  operation: TOperation;
  schema: TSchema;
  handler: TypedRouteHandler<TSchema>;
}): RouteDefinitionLiteral<TMethod, TPath, TSchema, TResource, TOperation> {
  return {
    method: config.method,
    path: config.path,
    config: {
      schema: config.schema,
      handler: config.handler,
      meta: {
        resource: config.resource,
        operation: config.operation,
      },
    },
  } as const;
}

export const serverRoutes = [
  createRoute({
    method: "GET",
    path: "/health",
    resource: "system",
    operation: "health",
    schema: {
      response: z.object({
        status: z.literal("ok"),
      }),
    },
    handler: async () => {
      return { status: "ok" as const };
    },
  }),
  createRoute({
    method: "GET",
    path: "/users/:id",
    resource: "users",
    operation: "get",
    schema: {
      params: z.object({
        id: z.string(),
      }),
      response: {
        200: userSchema,
        404: errorSchema,
      },
    },
    handler: async (request, reply) => {
      const user = USERS.find((candidate) => candidate.id === request.params.id);

      if (!user) {
        reply.code(404);
        return { error: "User not found" };
      }

      return user;
    },
  }),
  createRoute({
    method: "GET",
    path: "/projects",
    resource: "projects",
    operation: "list",
    schema: {
      response: z.object({
        items: z.array(projectSchema),
      }),
    },
    handler: async () => ({
      items: PROJECTS,
    }),
  }),
  createRoute({
    method: "GET",
    path: "/projects/:id",
    resource: "projects",
    operation: "get",
    schema: {
      params: z.object({
        id: z.string(),
      }),
      response: {
        200: projectSchema,
        404: errorSchema,
      },
    },
    handler: async ({ params }, reply) => {
      const project = PROJECTS.find((candidate) => candidate.id === params.id);

      if (!project) {
        reply.code(404);
        return { error: "Project not found" };
      }

      return project;
    },
  }),
] as const;

export async function registerRoutes(app: FastifyInstance) {
  for (const route of serverRoutes) {
    await app.route({
      method: route.method,
      url: route.path,
      schema: buildFastifySchema(route.config.schema),
      handler: route.config.handler as any,
    });
  }
}

export type ServerRoutes = typeof serverRoutes;
export type ServerRoute = ServerRoutes[number];
export type User = z.infer<typeof userSchema>;
export type Project = z.infer<typeof projectSchema>;
