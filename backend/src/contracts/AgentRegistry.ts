/**
 * AgentRegistry — mock of the on-chain registry that maps an agent to its
 * spending policy. On Monad this becomes a real contract read; for now it's an
 * in-memory map seeded with a couple of demo agents.
 *
 * Keep the public surface (getPolicy / setPolicy / isRegistered) stable so the
 * swap to a real ethers.Contract later is a one-file change.
 */

import type { AgentPolicy } from "../types/scenario.ts";
import { AGENTS, ALLOWLIST } from "../agent/identities.ts";
import { ADDRESSES, AGENT_ID } from "../agent/constants.ts";

const policies = new Map<string, AgentPolicy>();

function seed(policy: AgentPolicy) {
  policies.set(policy.agentId, policy);
}

// --- Demo agents ----------------------------------------------------------

// Atlas Treasury Agent — the agent that drives the scenario engine. Its policy
// is tuned to the deterministic demo constants (ADDRESSES + AMOUNTS) so the five
// scenarios each land on a distinct, intended verdict:
//   - safePayment   0.001 MON -> ApiProvider -> ALLOW   (allowlisted, below escrow threshold)
//   - escrow        0.002 MON -> Verifier    -> ESCROW  (above 0.0015 threshold, within caps)
//   - promptInject  10 MON    -> BadActor    -> BLOCK   (injection memo; also not allowlisted)
//   - overspend     1 MON     -> ApiProvider -> BLOCK   (DAILY_LIMIT_EXCEEDED; under per-tx cap)
// per-tx cap (1) stays above the overspend amount so the limit breach is
// reported as DAILY_LIMIT_EXCEEDED rather than MAX_PER_TX_EXCEEDED.
seed({
  agentId: AGENT_ID,
  maxPerTx: 1,
  dailyLimit: 0.5,
  allowlist: [ADDRESSES.apiProvider, ADDRESSES.verifier],
  requireEscrowAbove: 0.0015,
});

// Nova Ops Agent — looser rails, kept for realism / future scenarios.
seed({
  agentId: AGENTS.ops.handle,
  maxPerTx: 5_000,
  dailyLimit: 20_000,
  allowlist: ALLOWLIST,
  requireEscrowAbove: 500,
});

// --- Public API -----------------------------------------------------------

/** Default policy applied to unknown agents: maximally restrictive. */
const DEFAULT_POLICY = (agentId: string): AgentPolicy => ({
  agentId,
  maxPerTx: 0,
  dailyLimit: 0,
  allowlist: [],
  requireEscrowAbove: 0,
});

export function isRegistered(agentId: string): boolean {
  return policies.has(agentId);
}

/** Returns the agent's policy, or a deny-all default if unregistered. */
export function getPolicy(agentId: string): AgentPolicy {
  return policies.get(agentId) ?? DEFAULT_POLICY(agentId);
}

export function setPolicy(policy: AgentPolicy): AgentPolicy {
  policies.set(policy.agentId, policy);
  return policy;
}

export function listAgents(): AgentPolicy[] {
  return [...policies.values()];
}
