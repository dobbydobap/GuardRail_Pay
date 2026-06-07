/**
 * Tiny HTTP helpers shared by all routes. Keeps each route file focused on
 * business logic instead of Response/JSON boilerplate.
 */

import { log } from "./logger.ts";
import type { ApiError } from "../types/api.ts";

export type RouteHandler = (req: Request, url: URL) => Promise<Response> | Response;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

/** Typed JSON response with CORS enabled. The payload type is preserved. */
export function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

/** Typed error envelope ({@link ApiError}). */
export function error(message: string, status = 400): Response {
  return json<ApiError>({ ok: false, error: message }, status);
}

/** Safely parse a JSON request body; returns {} for empty/invalid bodies. */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Wrap a handler so any thrown error becomes a clean 500 JSON response instead
 * of crashing the request. Keeps each handler free of boilerplate try/catch
 * while still guaranteeing the requirement.
 */
export function withErrorHandling(handler: RouteHandler): RouteHandler {
  return async (req, url) => {
    try {
      return await handler(req, url);
    } catch (err) {
      log.error("route.error", {
        method: req.method,
        path: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
      // Never leak internals to clients.
      return error("Internal server error", 500);
    }
  };
}
