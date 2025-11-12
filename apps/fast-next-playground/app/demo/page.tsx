import Image from "next/image";
import Link from "next/link";
import type { Project } from "@/server/http/routes";
import { ProjectsClientPanel } from "@/components/projects-client-panel";
import { api } from "@/server/api";
import panelStyles from "@/components/projects-client-panel.module.css";
import { revalidatePath } from "next/cache";

const STATUS_OPTIONS = ["draft", "active", "archived"] as const;

async function createDemoProject(formData: FormData) {
  "use server";

  const rawName = formData.get("name")?.toString().trim();
  const status = formData.get("status")?.toString() ?? "draft";
  const normalizedStatus = STATUS_OPTIONS.includes(
    status as (typeof STATUS_OPTIONS)[number]
  )
    ? (status as (typeof STATUS_OPTIONS)[number])
    : "draft";
  const name =
    rawName && rawName.length > 0
      ? rawName
      : `Playground project ${Date.now().toString().slice(-4)}`;

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
    api.system.health.request().catch(() => null),
    api.projects.list.request().catch(() => null),
  ]);

  const projectsResponse = projectsResult?.data as
    | { items?: Project[] }
    | undefined;
  const projects = projectsResponse?.items ?? [];
  const recentProjects = projects.slice(0, 5);
  const health = healthResult?.data?.status ?? "unknown";

  return (
    <div className="min-h-screen bg-background px-6 py-12 text-foreground sm:px-10 lg:px-24">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className={`${panelStyles.panel} flex flex-col gap-6`}>
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
    <section className={`${panelStyles.panel} flex h-full flex-col gap-6`}>
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
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${
              ok
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
            }`}
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
        <div
          className={`${panelStyles.panel} rounded-[20px] bg-background/90 p-4 shadow-inner shadow-black/10 dark:bg-black/50`}
        >
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
