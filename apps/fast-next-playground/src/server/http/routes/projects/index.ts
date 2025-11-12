import { createProjectRoute } from "./create-project";
import { listProjectsRoute } from "./list-projects";

export const projectRoutes = [listProjectsRoute, createProjectRoute] as const;
