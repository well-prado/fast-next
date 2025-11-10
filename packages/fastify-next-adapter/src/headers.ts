export type FastifyCompatibleHeaders = Record<string, string | string[]>;

const MULTI_VALUE_HEADERS = new Set(["set-cookie"]);

/**
 * Converts the immutable Fetch API Headers object that Next.js exposes
 * into the plain object structure expected by Fastify's inject helper.
 */
export function convertNextHeaders(headers: Headers): FastifyCompatibleHeaders {
  const result: FastifyCompatibleHeaders = {};

  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    const existing = result[normalizedKey];

    if (
      existing === undefined ||
      (!Array.isArray(existing) && !MULTI_VALUE_HEADERS.has(normalizedKey))
    ) {
      result[normalizedKey] = value;
      return;
    }

    if (Array.isArray(existing)) {
      existing.push(value);
      return;
    }

    result[normalizedKey] = [existing, value];
  });

  return result;
}
