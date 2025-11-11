import type { BetterAuthOptions } from "@fast-next/better-auth";
import { createFastNextAuth } from "@fast-next/better-auth";

/**
 * Configure Better Auth adapters, providers, and secrets here.
 * Docs: https://better-auth.com/docs
 */
const authOptions = {
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  plugins: [],
} satisfies Partial<BetterAuthOptions>;

export const auth = createFastNextAuth(authOptions as BetterAuthOptions);
