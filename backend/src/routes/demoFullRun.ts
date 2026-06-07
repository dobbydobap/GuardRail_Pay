/**
 * POST /demo/full-run — the single endpoint that runs the entire demo story:
 *
 *   1 approved payment · 1 escrow creation · 1 escrow release
 *   1 prompt-injection attack (blocked) · 1 overspend attack (blocked)
 *
 * Returns every event (firewall verdicts, persisted to the EventStore) and
 * every LLM output (the agent's proposals). Always succeeds — verdicts are
 * deterministic and LLM outputs fall back gracefully when Ollama is unset.
 */

import { DemoRunner } from "../services/DemoRunner.ts";
import { json, type RouteHandler } from "../lib/http.ts";
import type { DemoFullRunResponse } from "../types/api.ts";

export const demoFullRun: RouteHandler = async () => {
  const result = await new DemoRunner().fullRun();
  return json<DemoFullRunResponse>({ ok: true, ...result });
};
