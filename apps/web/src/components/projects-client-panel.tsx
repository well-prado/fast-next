"use client";

import { useEffect, useMemo, useState } from "react";

import type { FormEvent } from "react";
import { api } from "@/client/api";
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

  useEffect(() => {
    console.log("[projects query] state", {
      status: query.status,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      items: query.response?.data?.items ?? [],
      error: query.error,
    });
  }, [
    query.status,
    query.isLoading,
    query.isFetching,
    query.response,
    query.error,
  ]);

  useEffect(() => {
    console.log("[projects mutation] state", {
      status: mutation.status,
      isPending: mutation.isPending,
      error: mutation.error,
      data: mutation.data,
    });
  }, [mutation.status, mutation.isPending, mutation.error, mutation.data]);

  const projects = useMemo(
    () => query.response?.data?.items ?? [],
    [query.response]
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log("[projects mutation] submitting", {
      projectName,
      status,
      existing: projects,
    });
    mutation.mutate({
      body: {
        name: projectName || `Client project ${projects.length + 1}`,
        status,
      },
    });
    console.log(
      "[projects mutation] mutate called, pending?",
      mutation.isPending
    );
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
              event.target.value as (typeof STATUS_OPTIONS)[number]["value"]
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
