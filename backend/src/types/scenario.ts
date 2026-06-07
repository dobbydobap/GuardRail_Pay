/**
 * Shared domain types for AgentVault / GuardRail Pay.
 *
 * The mental model: an AI agent asks to move money. Every request is run
 * through an on-chain "policy firewall" (mocked here) which returns one of
 * three verdicts:
 *
 *   ALLOW  -> payment may settle immediately
 *   ESCROW -> payment is parked and needs human approval
 *   BLOCK  -> payment is rejected outright (limit breach, bad recipient,
 *             prompt injection, etc.)
 */

export type PolicyVerdict = "ALLOW" | "ESCROW" | "BLOCK";

/**
 * An on-chain payment the firewall evaluates. `amount` is in whole token units
 * (mock). Distinct from the LLM-facing `PaymentRequest` in AgentRunner, which
 * is a string-amount DTO produced by the model.
 */
export interface PaymentIntent {
  agentId: string;
  to: string;
  amount: number;
  token?: string;
  /** Natural-language reason / instruction the agent acted on. */
  memo?: string;
}

/** A single rule that fired against a request. */
export interface PolicyViolation {
  rule: string;
  message: string;
  severity: "BLOCK" | "ESCROW";
}

/** Result of running a request through the policy firewall. */
export interface PolicyResult {
  verdict: PolicyVerdict;
  reasons: string[];
  violations: PolicyViolation[];
  request: PaymentIntent;
}

/** Per-agent spending policy, conceptually stored in AgentRegistry on-chain. */
export interface AgentPolicy {
  agentId: string;
  /** Hard cap for a single transaction. */
  maxPerTx: number;
  /** Rolling daily cap across all transactions. */
  dailyLimit: number;
  /** Allowed recipient addresses. Empty = allow any. */
  allowlist: string[];
  /** Amounts strictly above this require human escrow approval. */
  requireEscrowAbove: number;
}

export type EscrowStatus = "PENDING" | "APPROVED" | "REJECTED";

/** A payment held for human approval. */
export interface Escrow {
  id: string;
  agentId: string;
  to: string;
  amount: number;
  token?: string;
  memo?: string;
  status: EscrowStatus;
  createdAt: number;
  resolvedAt?: number;
  txHash?: string;
}

// ===========================================================================
// Canonical scenario result — the audit record persisted in the EventStore.
// ===========================================================================

/** Terminal status of a scenario, as surfaced to clients. */
export type ScenarioStatus =
  | "APPROVED"
  | "BLOCKED"
  | "ESCROW_CREATED"
  | "ESCROW_RELEASED";

/**
 * Recommended values for {@link ScenarioResult.actionType}. The field is typed
 * as `string` (open set) so new agent actions don't require a schema change,
 * but prefer these constants for anything the firewall knows about.
 */
export enum ActionType {
  PAYMENT = "PAYMENT",
  ESCROW_CREATE = "ESCROW_CREATE",
  ESCROW_RELEASE = "ESCROW_RELEASE",
  TRANSFER = "TRANSFER",
}

/**
 * The canonical, flat, JSON-serializable outcome of a single agent action.
 * One of these is produced per request and appended to the {@link EventStore};
 * it is the shape the REST API returns and the frontend renders.
 */
export type ScenarioResult = {
  /** Unique id for this action/decision (see `generateTaskId`). */
  taskId: string;
  /** Id of the agent that initiated the action. */
  agent: string;
  /** Recipient address. */
  to: string;
  /** Amount as a decimal string (avoids float precision loss). */
  amount: string;
  /** What the agent tried to do — see {@link ActionType}. */
  actionType: string;
  /** Human-readable explanation of the verdict. */
  reason: string;
  /** Terminal status of the action. */
  status: ScenarioStatus;

  /** Populated when `status === "BLOCKED"`; null/absent otherwise. */
  blockReason?: string | null;
  /** Mock (later: real) settlement tx hash, when a payment moved. */
  txHash?: string;
  /** Unix epoch milliseconds the result was produced. */
  timestamp: number;
};

// ===========================================================================
// Event store contract
// ===========================================================================

/** Filter passed to {@link EventStore.query}. All fields are AND-combined. */
export interface EventQuery {
  agent?: string;
  status?: ScenarioStatus;
  actionType?: string;
  /** Only results with `timestamp` strictly greater than this (ms). */
  since?: number;
  /** Cap the number of (most recent) results returned. */
  limit?: number;
}

/**
 * Append-only store of {@link ScenarioResult}s, keyed by `taskId`.
 *
 * Implementations are swappable: the MVP uses an in-memory array
 * (`store/scenarios.ts`); a production deployment could back this with Redis,
 * Postgres, or an on-chain indexer without touching call sites.
 */
export interface EventStore {
  /** Persist a result and return the stored copy. */
  addEvent(result: ScenarioResult): ScenarioResult;
  /** All results (oldest first), optionally filtered by {@link EventQuery}. */
  getEvents(query?: EventQuery): ScenarioResult[];
  /** Look up a single result by its task id. */
  getEventByTaskId(taskId: string): ScenarioResult | undefined;
  /** Drop everything (useful between demo runs). */
  clearEvents(): void;
  /** Number of stored results. */
  size(): number;
}
