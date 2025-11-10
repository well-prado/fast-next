import type { NextRequest } from "next/server";
import { handleNextRequest } from "@fast-next/fastify-next-adapter";
import { getAppInstance } from "../../../src/server/fastify-app";

async function handle(req: NextRequest) {
  const app = await getAppInstance();
  return handleNextRequest(req, app);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
