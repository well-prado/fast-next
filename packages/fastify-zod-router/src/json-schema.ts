import type { FastifySchema } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AnyZod, RouteResponseSchema, RouteSchema } from "./types";

const DEFAULT_STATUS_CODE = "200";

export function buildFastifySchema(schema: RouteSchema): FastifySchema {
  const fastifySchema: FastifySchema = {};

  const querySchema = schema.query ?? schema.querystring;

  assignIfPresent(fastifySchema, "body", schema.body);
  assignIfPresent(fastifySchema, "querystring", querySchema);
  assignIfPresent(fastifySchema, "params", schema.params);
  assignIfPresent(fastifySchema, "headers", schema.headers);

  const responseSchema = convertResponseSchema(schema.response);
  if (responseSchema) {
    fastifySchema.response = responseSchema;
  }

  return fastifySchema;
}

function assignIfPresent(target: FastifySchema, key: keyof FastifySchema, schema?: AnyZod) {
  if (!schema) return;
  const jsonSchema = convertZod(schema);
  if (jsonSchema) {
    target[key] = jsonSchema;
  }
}

function convertResponseSchema(schema?: RouteResponseSchema): FastifySchema["response"] {
  if (!schema) return undefined;

  if (isZodSchema(schema)) {
    return {
      [DEFAULT_STATUS_CODE]: convertZod(schema),
    };
  }

  const entries = Object.entries(schema).reduce<Record<string, unknown>>((acc, [status, value]) => {
    if (!value) return acc;
    const converted = convertZod(value);
    if (converted) {
      acc[status] = converted;
    }
    return acc;
  }, {});

  return Object.keys(entries).length ? entries : undefined;
}

function convertZod(schema: AnyZod) {
  return zodToJsonSchema(schema, {
    target: "jsonSchema7",
  });
}

function isZodSchema(value: unknown): value is AnyZod {
  return Boolean(value) && typeof (value as AnyZod)?.safeParse === "function";
}
