import { NextResponse } from "next/server";
import type { Response as LightMyRequestResponse } from "light-my-request";

function toHeadersInit(
  source: LightMyRequestResponse["headers"]
): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined) {
          headers.append(key, String(item));
        }
      });
      continue;
    }

    if (value === undefined) continue;
    headers.set(key, String(value));
  }

  return headers;
}

function toBodyInit(response: LightMyRequestResponse): BodyInit | null {
  if (response.rawPayload) {
    return new Uint8Array(response.rawPayload);
  }

  if (response.payload === undefined || response.payload === null) {
    return null;
  }

  if (typeof response.payload === "string") {
    return response.payload;
  }

  const value =
    typeof response.payload === "object"
      ? JSON.stringify(response.payload)
      : String(response.payload);

  return value;
}

export function convertToNextResponse(
  response: LightMyRequestResponse
): NextResponse {
  const headers = toHeadersInit(response.headers);
  const body = toBodyInit(response);
  const init: ResponseInit = {
    status: response.statusCode,
    headers,
  };

  if (body === null) {
    return new NextResponse(null, init);
  }

  return new NextResponse(body, init);
}
