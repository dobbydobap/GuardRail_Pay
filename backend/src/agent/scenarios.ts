/**
 * Scenario engine for AgentVault / GuardRail Pay.
 *
 * Each scenario runs a deterministic payment intent through the policy firewall
 * ({@link checkPolicy}), acts on the verdict (settle / escrow / block), and
 * records a canonical {@link ScenarioResult} in the EventStore. All addresses,
 * amounts, and reasons come from the shared {@link constants} module, so the
 * demo is fully deterministic — no random data anywhere.
 *
 * Five scenarios (verdicts derived from the demo agent's policy):
 *   1. safe payment      -> APPROVED
 *   2. create escrow     -> ESCROW_CREATED
 *   3. release escrow    -> ESCROW_RELEASED
 *   4. prompt injection  -> BLOCKED (ON_CHAIN_INJECTION_PATTERN)
 *   5. overspend         -> BLOCKED (DAILY_LIMIT_EXCEEDED)
 */

import {
  approveEscrow,
  checkPolicy,
  createEscrow,
  resetVaultState,
  settle,
} from "../contracts/AgentVault.ts";
import { createScenarioResult } from "../lib/generators.ts";
import { eventStore } from "../store/scenarios.ts";
import { ActionType, type PaymentIntent, type ScenarioResult, type ScenarioStatus } from "../types/scenario.ts";
import { ADDRESSES, AGENT_ID, AMOUNTS, REASONS, TOKEN } from "./constants.ts";

// --- Verdict mapping ------------------------------------------------------

/** Translate a firewall violation rule into the public `blockReason`. */
function mapBlockReason(rule: string): string {
  if (rule === "PROMPT_INJECTION") return "ON_CHAIN_INJECTION_PATTERN";
  return rule; // e.g. DAILY_LIMIT_EXCEEDED
}

interface Execution {
  status: ScenarioStatus;
  blockReason: string | null;
  txHash?: string;
  escrowId?: string;
}

/** Run an intent through the firewall and act on the verdict. */
function executePayment(req: PaymentIntent): Execution {
  const policy = checkPolicy(req);
  switch (policy.verdict) {
    case "ALLOW": {
      const { txHash } = settle(req);
      return { status: "APPROVED", blockReason: null, txHash };
    }
    case "ESCROW": {
      const escrow = createEscrow(req);
      return { status: "ESCROW_CREATED", blockReason: null, escrowId: escrow.id };
    }
    case "BLOCK": {
      const blocking = policy.violations.find((v) => v.severity === "BLOCK");
      return {
        status: "BLOCKED",
        blockReason: blocking ? mapBlockReason(blocking.rule) : "POLICY_VIOLATION",
      };
    }
  }
}

/** Persist a result in the EventStore and return it. */
function record(result: ScenarioResult): ScenarioResult {
  return eventStore.addEvent(result);
}

// --- Scenarios (deterministic) -------------------------------------------

/** 1. Safe payment to the approved API provider → APPROVED. */
function safeApiPayment(): ScenarioResult {
  const exec = executePayment({
    agentId: AGENT_ID,
    to: ADDRESSES.apiProvider,
    amount: Number(AMOUNTS.safePayment),
    token: TOKEN,
    memo: REASONS.safePayment,
  });
  return record(
    createScenarioResult({
      agent: AGENT_ID,
      to: ADDRESSES.apiProvider,
      amount: AMOUNTS.safePayment,
      actionType: ActionType.PAYMENT,
      reason: REASONS.safePayment,
      status: exec.status,
      blockReason: exec.blockReason,
      txHash: exec.txHash ?? null,
    }),
  );
}

/** 2. Open an escrow for the verifier → ESCROW_CREATED. */
function createEscrowScenario(): ScenarioResult {
  const exec = executePayment({
    agentId: AGENT_ID,
    to: ADDRESSES.verifier,
    amount: Number(AMOUNTS.escrow),
    token: TOKEN,
    memo: REASONS.escrowCreate,
  });
  return record(
    createScenarioResult({
      agent: AGENT_ID,
      to: ADDRESSES.verifier,
      amount: AMOUNTS.escrow,
      actionType: ActionType.ESCROW_CREATE,
      reason: REASONS.escrowCreate,
      status: exec.status,
      blockReason: exec.blockReason,
    }),
  );
}

/** 3. Release an escrow to the verifier → ESCROW_RELEASED. */
function releaseEscrowScenario(): ScenarioResult {
  const escrow = createEscrow({
    agentId: AGENT_ID,
    to: ADDRESSES.verifier,
    amount: Number(AMOUNTS.escrow),
    token: TOKEN,
    memo: REASONS.escrowCreate,
  });
  const release = approveEscrow(escrow.id);
  const ok = release.ok && release.escrow?.status === "APPROVED";

  return record(
    createScenarioResult({
      agent: AGENT_ID,
      to: ADDRESSES.verifier,
      amount: AMOUNTS.escrow,
      actionType: ActionType.ESCROW_RELEASE,
      reason: REASONS.escrowRelease,
      status: ok ? "ESCROW_RELEASED" : "BLOCKED",
      blockReason: ok ? null : "ESCROW_RELEASE_FAILED",
      txHash: ok ? release.escrow?.txHash ?? null : null,
    }),
  );
}

/** 4. Prompt-injection attack → BLOCKED (ON_CHAIN_INJECTION_PATTERN). */
function promptInjectionScenario(): ScenarioResult {
  const exec = executePayment({
    agentId: AGENT_ID,
    to: ADDRESSES.badActor,
    amount: Number(AMOUNTS.promptInjection),
    token: TOKEN,
    memo: REASONS.promptInjection, // matches the on-chain injection pattern
  });
  return record(
    createScenarioResult({
      agent: AGENT_ID,
      to: ADDRESSES.badActor,
      amount: AMOUNTS.promptInjection,
      actionType: ActionType.TRANSFER,
      reason: REASONS.promptInjection,
      status: exec.status,
      blockReason: exec.blockReason,
    }),
  );
}

/** 5. Overspend attack → BLOCKED (DAILY_LIMIT_EXCEEDED). */
function overspendScenario(): ScenarioResult {
  const exec = executePayment({
    agentId: AGENT_ID,
    to: ADDRESSES.apiProvider,
    amount: Number(AMOUNTS.overspend),
    token: TOKEN,
    memo: REASONS.overspend,
  });
  return record(
    createScenarioResult({
      agent: AGENT_ID,
      to: ADDRESSES.apiProvider,
      amount: AMOUNTS.overspend,
      actionType: ActionType.PAYMENT,
      reason: REASONS.overspend,
      status: exec.status,
      blockReason: exec.blockReason,
    }),
  );
}

// --- Runner ---------------------------------------------------------------

export interface RunAllOptions {
  /** Reset firewall spend/escrow state first so the run is deterministic. */
  reset?: boolean;
}

/** Run all five scenarios in order and return their results (oldest first). */
export function runAllScenarios(opts: RunAllOptions = {}): ScenarioResult[] {
  if (opts.reset !== false) resetVaultState();
  return [
    safeApiPayment(),
    createEscrowScenario(),
    releaseEscrowScenario(),
    promptInjectionScenario(),
    overspendScenario(),
  ];
}
