import { z } from "zod";

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "archived"]),
});

export type Project = z.infer<typeof projectSchema>;

const projects: Project[] = [
  { id: "p1", name: "DX Overhaul", status: "active" },
  { id: "p2", name: "Edge API Gateway", status: "draft" },
  { id: "p3", name: "Realtime Sync", status: "archived" },
];

export function listProjects() {
  return projects;
}

export function addProject(project: Project) {
  projects.push(project);
  return project;
}
