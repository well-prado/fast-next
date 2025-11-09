import type { FastifyInstance } from "fastify";
import { createRoute, registerRoutes as registerFastifyRoutes, type FastifyRouteDefinition } from "@fast-next/fastify-router";
import type { TypedRouteHandler } from "@fast-next/fastify-zod-router";
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
      items: PROJECTS,
    })) satisfies TypedRouteHandler<typeof listProjectsSchema>,
  }),
  createRoute({
    method: "GET",
    path: "/projects/:id",
    resource: "projects",
    operation: "get",
    schema: getProjectSchema,
    handler: (async ({ params }, reply) => {
      const project = PROJECTS.find((candidate) => candidate.id === params.id);

      if (!project) {
        reply.code(404);
        return { error: "Project not found" };
      }

      return project;
    }) satisfies TypedRouteHandler<typeof getProjectSchema>,
  }),
] as const satisfies readonly FastifyRouteDefinition[];

export type ServerRoutes = typeof serverRoutes;
export type ServerRoute = ServerRoutes[number];
export type User = z.infer<typeof userSchema>;
export type Project = z.infer<typeof projectSchema>;

export async function registerRoutes(app: FastifyInstance) {
  await registerFastifyRoutes(app, serverRoutes);
}
