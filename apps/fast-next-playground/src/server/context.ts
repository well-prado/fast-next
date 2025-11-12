import { getDatabase } from "./services/drizzle/client";

export async function createAppContext() {
  const database = await getDatabase();
  return { database };
}

export type AppContext = Awaited<ReturnType<typeof createAppContext>>;
