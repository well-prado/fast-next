import { createNextAuthHandler } from "@fast-next/better-auth";
import { auth } from "../../../../server/services/auth/better-auth";

const handlers = createNextAuthHandler({ auth });

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
