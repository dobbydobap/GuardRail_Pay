/**
 * GET /events — read stored ScenarioResults from the EventStore.
 *
 * Filters (all optional, AND-combined):
 *   ?agent=        ?status=        ?actionType=
 *   ?since=<ms>     ?limit=<n>
 *
 * Returns 200 with `{ ok, count, events }`.
 */

import { eventStore } from "../store/scenarios.ts";
import { type ScenarioStatus } from "../types/scenario.ts";
import { json, type RouteHandler } from "../lib/http.ts";
import type { EventsResponse } from "../types/api.ts";

export const getEvents: RouteHandler = (_req, url) => {
  const p = url.searchParams;
  const sinceRaw = p.get("since");
  const limitRaw = p.get("limit");

  const events = eventStore.getEvents({
    agent: p.get("agent") ?? undefined,
    status: (p.get("status") as ScenarioStatus | null) ?? undefined,
    actionType: p.get("actionType") ?? undefined,
    since: sinceRaw ? Number(sinceRaw) : undefined,
    limit: limitRaw ? Number(limitRaw) : undefined,
  });

  return json<EventsResponse>({ ok: true, count: events.length, events });
};
