/**
 * GET /health — liveness + dependency connectivity.
 *
 * Always returns 200 with status "ok" (the server is up); the booleans report
 * whether each dependency is currently reachable. Probes are timeout-bounded
 * and never throw, so this endpoint cannot hang or crash.
 */

import { checkConnectivity } from "../services/health.ts";
import { json, type RouteHandler } from "../lib/http.ts";
import type { HealthResponse } from "../types/api.ts";

export const health: RouteHandler = async () => {
  const connectivity = await checkConnectivity();
  const body: HealthResponse = {
    status: "ok",
    timestamp: Date.now(),
    ...connectivity,
  };
  return json(body);
};
