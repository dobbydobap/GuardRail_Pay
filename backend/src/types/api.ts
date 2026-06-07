/**
 * Typed shapes for every REST response, so handlers can't accidentally return
 * an inconsistent body. Success responses carry `ok: true`; failures use
 * {@link ApiError}.
 */

import type { ScenarioResult } from "./scenario.ts";
import type { DemoRunResponse } from "../services/DemoRunner.ts";

/** Error envelope returned by `error()` and the dispatcher. */
export interface ApiError {
  ok: false;
  error: string;
}

/** Root `/` info response. */
export interface RootResponse {
  service: string;
  status: "ok";
  routes: string[];
}

/** `GET /events` response. */
export interface EventsResponse {
  ok: true;
  count: number;
  events: ScenarioResult[];
}

/** `POST /demo/full-run` response. */
export interface DemoFullRunResponse extends DemoRunResponse {
  ok: true;
}

/** `GET /health` response (exact shape required by the spec). */
export interface HealthResponse {
  status: "ok";
  timestamp: number;
  rpcConnected: boolean;
  contractConnected: boolean;
  ollamaConnected: boolean;
}
