/**
 * AgentVault / GuardRail Pay — backend entrypoint.
 *
 * A single Bun.serve() process exposing the REST API. No DB, no auth, no ORM —
 * all state is in-memory (the EventStore singleton + the AgentVault contract
 * mocks). Every endpoint drives the scenario engine internally and returns the
 * canonical ScenarioResult (or, for /events, the stored history).
 *
 * Run:  bun run dev   (watch mode)  |  bun run start
 *
 * Routes:
 *   POST /demo/full-run  -> run the entire demo story (events + LLM outputs)
 *   GET  /events         -> stored ScenarioResults (history feed)
 *   GET  /health         -> liveness + dependency connectivity
 *   GET  /               -> route map
 */

import { corsPreflight, error, json, withErrorHandling, type RouteHandler } from "./lib/http.ts";
import { log } from "./lib/logger.ts";

import { demoFullRun } from "./routes/demoFullRun.ts";
import { getEvents } from "./routes/events.ts";
import { health } from "./routes/health.ts";
import { startEventSyncIfConfigured } from "./contracts/EventSyncService.ts";
import type { RootResponse } from "./types/api.ts";

const PORT = Number(Bun.env.PORT ?? 3000);

/** "METHOD /path" -> typed handler. Exact-match, dependency-free routing. */
const routes: Record<string, RouteHandler> = {
  "POST /demo/full-run": demoFullRun,
  "GET /events": getEvents,
  "GET /health": health,
};

// Wrap every handler so thrown errors become clean 500s (the try/catch seam).
const handlers: Record<string, RouteHandler> = Object.fromEntries(
  Object.entries(routes).map(([key, handler]) => [key, withErrorHandling(handler)]),
);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const startedAt = Date.now();

    // Outermost guard: nothing below can crash the server.
    try {
      if (req.method === "OPTIONS") return corsPreflight();

      if (url.pathname === "/" && req.method === "GET") {
        const body: RootResponse = {
          service: "GuardRail Pay (AgentVault) — backend MVP",
          status: "ok",
          routes: Object.keys(routes),
        };
        return json(body);
      }

      const handler = handlers[`${req.method} ${url.pathname}`];
      if (!handler) return error(`No route for ${req.method} ${url.pathname}`, 404);

      const res = await handler(req, url);
      log.info("request", { method: req.method, path: url.pathname, status: res.status, ms: Date.now() - startedAt });
      return res;
    } catch (err) {
      // Should be unreachable (handlers are wrapped), but guarantees liveness.
      log.error("unhandled", {
        method: req.method,
        path: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
      return error("Internal server error", 500);
    }
  },
});

log.info("server.start", { port: server.port, service: "guardrail-pay" });

// Sync on-chain AgentVault events into the EventStore when a chain is
// configured; otherwise the app runs in mock-only mode.
void startEventSyncIfConfigured();
