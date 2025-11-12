"use client";

import { useMemo, useState, type FormEvent } from "react";
import { api } from "@/client/api";
import type { Project } from "@/server/http/routes";
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

  const projects = useMemo<Project[]>(() => {
    const response = query.response?.data as { items?: Project[] } | undefined;
    return response?.items ?? [];
  }, [query.response]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    mutation.mutate({
      body: {
        name: projectName || `Client project ${projects.length + 1}`,
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
