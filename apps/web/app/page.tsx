import Image, { type ImageProps } from "next/image";
import { Button } from "@repo/ui/button";
import { api } from "@/server/api";
import type { Project, User } from "@/server/routes";
import styles from "./page.module.css";

type Props = Omit<ImageProps, "src"> & {
  srcLight: string;
  srcDark: string;
};

const ThemeImage = (props: Props) => {
  const { srcLight, srcDark, ...rest } = props;

  return (
    <>
      <Image {...rest} src={srcLight} className="imgLight" />
      <Image {...rest} src={srcDark} className="imgDark" />
    </>
  );
};

async function getFeaturedUser(): Promise<User | null> {
  const result = await api.users.get.query({
    params: { id: "1" },
  });

  if (result.statusCode !== 200) {
    return null;
  }

  return (result.data ?? null) as User | null;
}

async function getProjects(): Promise<Project[]> {
  // const result = await api.projects.list.query();
  const { data: projectsData, statusCode } = await api.projects.list.query();
  if (statusCode !== 200) {
    return [];
  }

  return projectsData.items;
}

export default async function Home() {
  const [featuredUser, projects] = await Promise.all([
    getFeaturedUser(),
    getProjects(),
  ]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <ThemeImage
          className={styles.logo}
          srcLight="turborepo-dark.svg"
          srcDark="turborepo-light.svg"
          alt="Turborepo logo"
          width={180}
          height={38}
          priority
        />
        {featuredUser && (
          <section className={styles.description}>
            <p>
              <strong>Featured user (server api):</strong> {featuredUser.name} —{" "}
              {featuredUser.title}
            </p>
            <p>Served by calling the Fastify handler directly (no HTTP hop).</p>
          </section>
        )}
        {projects.length > 0 && (
          <section className={styles.projects}>
            <h2>Active projects</h2>
            <ul>
              {projects.map((project) => (
                <li key={project.id}>
                  <span>{project.name}</span>
                  <span className={styles[`status${project.status}`]}>
                    {project.status}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              These entries come from the same Fastify router but are rendered
              via the server API client—no HTTP hop required.
            </p>
          </section>
        )}
        <ol>
          <li>
            Get started by editing <code>apps/web/app/page.tsx</code>
          </li>
          <li>Save and see your changes instantly.</li>
        </ol>

        <div className={styles.ctas}>
          <a
            className={styles.primary}
            href="https://vercel.com/new/clone?demo-description=Learn+to+implement+a+monorepo+with+a+two+Next.js+sites+that+has+installed+three+local+packages.&demo-image=%2F%2Fimages.ctfassets.net%2Fe5382hct74si%2F4K8ZISWAzJ8X1504ca0zmC%2F0b21a1c6246add355e55816278ef54bc%2FBasic.png&demo-title=Monorepo+with+Turborepo&demo-url=https%3A%2F%2Fexamples-basic-web.vercel.sh%2F&from=templates&project-name=Monorepo+with+Turborepo&repository-name=monorepo-turborepo&repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fturborepo%2Ftree%2Fmain%2Fexamples%2Fbasic&root-directory=apps%2Fdocs&skippable-integrations=1&teamSlug=vercel&utm_source=create-turbo"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image
              className={styles.logo}
              src="/vercel.svg"
              alt="Vercel logomark"
              width={20}
              height={20}
            />
            Deploy now
          </a>
          <a
            href="https://turborepo.com/docs?utm_source"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.secondary}
          >
            Read our docs
          </a>
        </div>
        <Button appName="web" className={styles.secondary}>
          Open alert
        </Button>
      </main>
      <footer className={styles.footer}>
        <a
          href="https://vercel.com/templates?search=turborepo&utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/window.svg"
            alt="Window icon"
            width={16}
            height={16}
          />
          Examples
        </a>
        <a
          href="https://turborepo.com?utm_source=create-turbo"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/globe.svg"
            alt="Globe icon"
            width={16}
            height={16}
          />
          Go to turborepo.com →
        </a>
      </footer>
    </div>
  );
}
