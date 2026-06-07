/**
 * ID / timestamp / hash generators.
 *
 * Centralized so every layer mints identifiers the same way and the mock tx
 * hash logic lives in exactly one place (swap `generateTxHash` for a real
 * receipt hash once the Monad contracts are wired).
 */

import { randomBytes } from "node:crypto";
import type { ScenarioResult, ScenarioStatus } from "../types/scenario.ts";

/** Current Unix time in milliseconds. Wrap `Date.now` so it can be mocked. */
export function timestamp(): number {
  return Date.now();
}

/**
 * Time-sortable, collision-resistant task id, e.g. `task_lq3f8k2a_9f3c1b7d`.
 *
 * The middle segment is the creation time in base36 (so ids sort
 * chronologically as strings); the suffix is 8 bytes of randomness to avoid
 * collisions within the same millisecond.
 */
export function generateTaskId(): string {
  const time = timestamp().toString(36);
  const rand = randomBytes(8).toString("hex");
  return `task_${time}_${rand}`;
}

/** Escrow id with the same scheme, distinct prefix. */
export function generateEscrowId(): string {
  const time = timestamp().toString(36);
  const rand = randomBytes(6).toString("hex");
  return `esc_${time}_${rand}`;
}

/** A believable-looking 32-byte (0x + 64 hex) EVM transaction hash. */
export function generateTxHash(): string {
  return "0x" + randomBytes(32).toString("hex");
}

/** Short, URL-safe random id for misc use. */
export function shortId(bytes = 6): string {
  return randomBytes(bytes).toString("hex");
}

/** Fields a caller must supply; `taskId`/`timestamp` are generated, and a
 * `txHash` is auto-minted for settled (APPROVED / ESCROW_RELEASED) actions. */
export interface ScenarioResultInput {
  agent: string;
  to: string;
  /** Number or string; coerced to the canonical decimal-string `amount`. */
  amount: string | number;
  actionType: string;
  reason: string;
  status: ScenarioStatus;
  blockReason?: string | null;
  /** Override the auto-generated tx hash, or pass null to suppress it. */
  txHash?: string | null;
}

const SETTLED: ReadonlySet<ScenarioStatus> = new Set<ScenarioStatus>([
  "APPROVED",
  "ESCROW_RELEASED",
]);

/**
 * Build a canonical {@link ScenarioResult}, generating `taskId` + `timestamp`
 * and minting a `txHash` for settled actions unless one is explicitly provided.
 */
export function createScenarioResult(input: ScenarioResultInput): ScenarioResult {
  const settled = SETTLED.has(input.status);
  const txHash =
    input.txHash === undefined
      ? settled
        ? generateTxHash()
        : undefined
      : input.txHash ?? undefined;

  return {
    taskId: generateTaskId(),
    agent: input.agent,
    to: input.to,
    amount: String(input.amount),
    actionType: input.actionType,
    reason: input.reason,
    status: input.status,
    blockReason: input.blockReason ?? null,
    txHash,
    timestamp: timestamp(),
  };
}
