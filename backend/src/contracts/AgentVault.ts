/**
 * AgentVault — mock of the on-chain policy firewall.
 *
 * This is the heart of GuardRail Pay. Every payment request is run through
 * `checkPolicy`, which consults the agent's AgentRegistry policy and returns a
 * verdict (ALLOW / ESCROW / BLOCK). Escrowed payments wait for human approval;
 * allowed payments "settle" with a mock tx hash.
 *
 * Daily spend is tracked in-memory per agent. Replace the internals with
 * ethers v6 contract calls later — the exported functions are the seam.
 */

import { getAddress } from "ethers";
import { generateEscrowId, generateTxHash } from "../lib/generators.ts";
import type {
  AgentPolicy,
  Escrow,
  EscrowStatus,
  PaymentIntent,
  PolicyResult,
  PolicyViolation,
} from "../types/scenario.ts";
import { getPolicy, isRegistered } from "./AgentRegistry.ts";

// --- Mock chain state -----------------------------------------------------

/** agentId -> amount spent in the current (mock) day. */
const dailySpent = new Map<string, number>();
const escrows = new Map<string, Escrow>();

function spentToday(agentId: string): number {
  return dailySpent.get(agentId) ?? 0;
}

function addSpend(agentId: string, amount: number): void {
  dailySpent.set(agentId, spentToday(agentId) + amount);
}

/** Normalize an address; returns null if it isn't a valid EVM address. */
function normalizeAddress(addr: string): string | null {
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

// --- Prompt-injection heuristics ------------------------------------------
//
// A real system would let the agent's LLM layer judge this; here we keep a
// deterministic keyword guard inside the "contract" so the firewall blocks
// laundered instructions even if the agent itself was fooled.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|previous|prior) (instructions|rules)/i,
  /disregard (the|all|your) (policy|rules|guardrails)/i,
  /bypass (the )?(policy|firewall|limit|guardrail)/i,
  /you are now/i,
  /system prompt/i,
  /developer mode/i,
  /send (all|everything|the entire balance)/i,
  /drain (the )?(wallet|vault|treasury|funds)/i,
  /new (instructions|recipient).*0x[a-fA-F0-9]{40}/i,
];

function detectInjection(text?: string): { hit: boolean; pattern?: string } {
  if (!text) return { hit: false };
  for (const re of INJECTION_PATTERNS) {
    if (re.test(text)) return { hit: true, pattern: re.source };
  }
  return { hit: false };
}

// --- Policy firewall ------------------------------------------------------

/**
 * Run a payment request through the firewall. Pure: does not mutate spend or
 * create escrows — call `settle` / `createEscrow` afterwards based on verdict.
 */
export function checkPolicy(
  request: PaymentIntent,
  policy: AgentPolicy = getPolicy(request.agentId),
): PolicyResult {
  const violations: PolicyViolation[] = [];
  const reasons: string[] = [];

  // 0. Agent must be registered.
  if (!isRegistered(request.agentId)) {
    violations.push({
      rule: "UNREGISTERED_AGENT",
      message: `Agent '${request.agentId}' is not registered in AgentRegistry.`,
      severity: "BLOCK",
    });
  }

  // 1. Recipient must be a valid address.
  const to = normalizeAddress(request.to);
  if (!to) {
    violations.push({
      rule: "INVALID_RECIPIENT",
      message: `Recipient '${request.to}' is not a valid EVM address.`,
      severity: "BLOCK",
    });
  }

  // 2. Amount sanity.
  if (!(request.amount > 0) || !Number.isFinite(request.amount)) {
    violations.push({
      rule: "INVALID_AMOUNT",
      message: `Amount '${request.amount}' must be a positive number.`,
      severity: "BLOCK",
    });
  }

  // 3. Prompt-injection guard on the memo / instruction.
  const injection = detectInjection(request.memo);
  if (injection.hit) {
    violations.push({
      rule: "PROMPT_INJECTION",
      message: `Memo matched an injection pattern (${injection.pattern}).`,
      severity: "BLOCK",
    });
  }

  // 4. Recipient allowlist (empty allowlist = allow any).
  if (to && policy.allowlist.length > 0) {
    const allowed = policy.allowlist.some(
      (a) => normalizeAddress(a) === to,
    );
    if (!allowed) {
      violations.push({
        rule: "RECIPIENT_NOT_ALLOWED",
        message: `Recipient ${to} is not on agent's allowlist.`,
        severity: "BLOCK",
      });
    }
  }

  // 5. Per-transaction cap.
  if (request.amount > policy.maxPerTx) {
    violations.push({
      rule: "MAX_PER_TX_EXCEEDED",
      message: `Amount ${request.amount} exceeds per-tx cap of ${policy.maxPerTx}.`,
      severity: "BLOCK",
    });
  }

  // 6. Rolling daily limit.
  const projected = spentToday(request.agentId) + request.amount;
  if (projected > policy.dailyLimit) {
    violations.push({
      rule: "DAILY_LIMIT_EXCEEDED",
      message: `Projected daily spend ${projected} exceeds limit of ${policy.dailyLimit}.`,
      severity: "BLOCK",
    });
  }

  // 7. Large-but-valid payments require human escrow.
  const blocking = violations.filter((v) => v.severity === "BLOCK");
  if (blocking.length === 0 && request.amount > policy.requireEscrowAbove) {
    violations.push({
      rule: "ESCROW_REQUIRED",
      message: `Amount ${request.amount} is above escrow threshold of ${policy.requireEscrowAbove}; needs human approval.`,
      severity: "ESCROW",
    });
  }

  // Derive the final verdict.
  let verdict: PolicyResult["verdict"] = "ALLOW";
  if (blocking.length > 0) {
    verdict = "BLOCK";
    reasons.push(...blocking.map((v) => v.message));
  } else if (violations.some((v) => v.severity === "ESCROW")) {
    verdict = "ESCROW";
    reasons.push(...violations.filter((v) => v.severity === "ESCROW").map((v) => v.message));
  } else {
    reasons.push("All policy checks passed.");
  }

  return { verdict, reasons, violations, request };
}

// --- Settlement & escrow --------------------------------------------------

/** Settle an allowed payment immediately. Mutates daily spend. */
export function settle(request: PaymentIntent): { txHash: string } {
  addSpend(request.agentId, request.amount);
  return { txHash: generateTxHash() };
}

export function createEscrow(request: PaymentIntent): Escrow {
  const id = generateEscrowId();
  const escrow: Escrow = {
    id,
    agentId: request.agentId,
    to: request.to,
    amount: request.amount,
    token: request.token,
    memo: request.memo,
    status: "PENDING",
    createdAt: Date.now(),
  };
  escrows.set(id, escrow);
  return escrow;
}

export function getEscrow(id: string): Escrow | undefined {
  return escrows.get(id);
}

export function listEscrows(status?: EscrowStatus): Escrow[] {
  const all = [...escrows.values()];
  return status ? all.filter((e) => e.status === status) : all;
}

export interface ResolveResult {
  ok: boolean;
  escrow?: Escrow;
  error?: string;
}

/** Approve a pending escrow: settles the payment and stamps a tx hash. */
export function approveEscrow(id: string): ResolveResult {
  const escrow = escrows.get(id);
  if (!escrow) return { ok: false, error: `Escrow ${id} not found.` };
  if (escrow.status !== "PENDING") {
    return { ok: false, error: `Escrow ${id} already ${escrow.status}.` };
  }

  // Re-check policy at approval time (daily limit may have changed since).
  const recheck = checkPolicy({
    agentId: escrow.agentId,
    to: escrow.to,
    amount: escrow.amount,
    memo: escrow.memo,
  });
  if (recheck.verdict === "BLOCK") {
    return { ok: false, error: `Escrow ${id} now violates policy: ${recheck.reasons[0]}` };
  }

  const { txHash } = settle({
    agentId: escrow.agentId,
    to: escrow.to,
    amount: escrow.amount,
    memo: escrow.memo,
  });

  escrow.status = "APPROVED";
  escrow.resolvedAt = Date.now();
  escrow.txHash = txHash;
  return { ok: true, escrow };
}

export function rejectEscrow(id: string, reason?: string): ResolveResult {
  const escrow = escrows.get(id);
  if (!escrow) return { ok: false, error: `Escrow ${id} not found.` };
  if (escrow.status !== "PENDING") {
    return { ok: false, error: `Escrow ${id} already ${escrow.status}.` };
  }
  escrow.status = "REJECTED";
  escrow.resolvedAt = Date.now();
  if (reason) escrow.memo = `${escrow.memo ?? ""} [rejected: ${reason}]`.trim();
  return { ok: true, escrow };
}

// --- Test/demo helpers ----------------------------------------------------

export function resetVaultState(): void {
  dailySpent.clear();
  escrows.clear();
}

export function getDailySpent(agentId: string): number {
  return spentToday(agentId);
}
