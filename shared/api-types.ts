/**
 * Shared API types for the AgentVault / GuardRail Pay backend.
 *
 * This is the single source of truth for the request/response shapes exchanged
 * between the backend and the frontend. It is dependency-free and framework-
 * agnostic — copy or symlink it into the frontend, or import it directly.
 *
 * Endpoints covered:
 *   GET  /health         -> HealthResponse
 *   GET  /events         -> EventsResponse        (query: EventsQuery)
 *   POST /demo/full-run  -> DemoFullRunResponse
 *
 * Every successful response carries `ok: true` (except /health, which always
 * returns `status: "ok"`); every error uses {@link ApiError} with `ok: false`.
 */

// ===========================================================================
// Primitive / domain enums
// ===========================================================================

/** Terminal status of a scenario, as surfaced to clients. */
export type ScenarioStatus =
  | "APPROVED"
  | "BLOCKED"
  | "ESCROW_CREATED"
  | "ESCROW_RELEASED";

/**
 * What the agent tried to do. Typed as a string union for the known set, but
 * the backend treats `actionType` as an open string, so tolerate unknown values
 * if you switch on it (always include a `default` branch).
 */
export type ActionType =
  | "PAYMENT"
  | "ESCROW_CREATE"
  | "ESCROW_RELEASE"
  | "TRANSFER";

/** Source of an LLM proposal: a real model call, or the deterministic stand-in. */
export type LlmSource = "ollama" | "fallback";

/** The three agent-driven acts that produce an LLM proposal. */
export type DemoScenario = "safe_payment" | "prompt_injection" | "overspend";

// ===========================================================================
// Core record: ScenarioResult (the audit record the API returns)
// ===========================================================================

/**
 * The canonical, flat, JSON-serializable outcome of a single agent action.
 * Returned by `/events` and embedded in the `/demo/full-run` response.
 */
export interface ScenarioResult {
  /** Unique id for this action/decision, e.g. "task_mq3ll5jz_599762346aece365". */
  taskId: string;
  /** Id of the agent that initiated the action, e.g. "atlas-treasury-agent". */
  agent: string;
  /** Recipient address (0x…40 hex). */
  to: string;
  /** Amount as a decimal string (avoids float precision loss), e.g. "0.001". */
  amount: string;
  /** What the agent tried to do — see {@link ActionType}. */
  actionType: ActionType | string;
  /** Human-readable explanation of the verdict. */
  reason: string;
  /** Terminal status of the action. */
  status: ScenarioStatus;
  /**
   * Machine-readable block reason. Present and non-null only when
   * `status === "BLOCKED"`; `null` otherwise. Known values include
   * "ON_CHAIN_INJECTION_PATTERN" and "DAILY_LIMIT_EXCEEDED".
   */
  blockReason?: string | null;
  /** Settlement tx hash (0x…64 hex). Present only when a payment moved. */
  txHash?: string;
  /** Unix epoch milliseconds the result was produced. */
  timestamp: number;
}

// ===========================================================================
// Error envelope
// ===========================================================================

/** Error envelope returned for any non-2xx response. */
export interface ApiError {
  ok: false;
  error: string;
}

// ===========================================================================
// GET /health
// ===========================================================================

/**
 * `GET /health` response. Always HTTP 200 with `status: "ok"` (the server is
 * up); the booleans report whether each dependency is currently usable.
 * `ollamaConnected` is true only when the configured model is actually served.
 */
export interface HealthResponse {
  status: "ok";
  /** Unix epoch milliseconds at which the probe ran. */
  timestamp: number;
  rpcConnected: boolean;
  contractConnected: boolean;
  ollamaConnected: boolean;
}

// ===========================================================================
// GET /events
// ===========================================================================

/**
 * Query parameters for `GET /events` (all optional, AND-combined).
 * Serialize into the querystring; numbers are sent as strings.
 */
export interface EventsQuery {
  /** Filter by initiating agent id. */
  agent?: string;
  /** Filter by terminal status. */
  status?: ScenarioStatus;
  /** Filter by action type. */
  actionType?: ActionType | string;
  /** Only results with `timestamp` strictly greater than this (ms). */
  since?: number;
  /** Cap the number of (most recent) results returned. */
  limit?: number;
}

/** `GET /events` success response. Events are ordered oldest-first. */
export interface EventsResponse {
  ok: true;
  /** Number of events in this response (after filtering). */
  count: number;
  events: ScenarioResult[];
}

// ===========================================================================
// POST /demo/full-run
// ===========================================================================

/**
 * The agent's LLM-facing payment proposal. Distinct from {@link ScenarioResult}:
 * this is what the agent *proposed*; the ScenarioResult is what the firewall
 * *decided*. `to`/`amount`/`actionType`/`reason` mirror the deterministic demo
 * constants so a proposal always matches its corresponding event.
 */
export interface PaymentRequest {
  to: string;
  amount: string;
  actionType: ActionType | string;
  reason: string;
}

/** One agent proposal in the demo, tagged with how it was produced. */
export interface LlmOutput {
  scenario: DemoScenario;
  /** "ollama" = generated by the model; "fallback" = deterministic stand-in. */
  source: LlmSource;
  request: PaymentRequest;
}

/** Aggregate counts across all events produced by a demo run. */
export interface DemoSummary {
  approvedPayments: number;
  blockedPayments: number;
  escrowOperations: number;
  totalEvents: number;
}

/**
 * `POST /demo/full-run` success response. Runs the entire five-act demo story
 * and returns the firewall verdicts (`events`) plus the agent proposals
 * (`llmOutputs`). The request body is ignored (send none or `{}`).
 */
export interface DemoFullRunResponse {
  ok: true;
  summary: DemoSummary;
  llmOutputs: LlmOutput[];
  events: ScenarioResult[];
}

// ===========================================================================
// Convenience unions
// ===========================================================================

/** Any success response body returned by the API. */
export type ApiSuccess = HealthResponse | EventsResponse | DemoFullRunResponse;

/** Any response body — success or error. Narrow on `ok` (or `status`). */
export type ApiResponse = ApiSuccess | ApiError;
