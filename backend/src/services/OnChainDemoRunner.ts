/**
 * OnChainDemoRunner — runs the full GuardRail Pay story against the REAL
 * deployed AgentVault on Monad testnet (no mocks, no fabricated tx hashes).
 *
 * Each act is a live transaction signed by the agent/verifier wallet; the
 * contract itself decides APPROVED vs BLOCKED and emits the event we decode.
 * Every returned ScenarioResult carries a real on-chain `txHash`.
 *
 * The five acts (verdicts enforced on-chain):
 *   1. safe payment      -> APPROVED
 *   2. create escrow     -> ESCROW_CREATED
 *   3. release escrow    -> ESCROW_RELEASED   (approve, then release)
 *   4. prompt injection  -> BLOCKED (ON_CHAIN_INJECTION_PATTERN)
 *   5. overspend         -> BLOCKED (MAX_PER_PAYMENT_EXCEEDED)
 *
 * Amounts are chosen to fit the live policy (maxPerPayment 0.01, daily 0.05)
 * so acts 1–3 settle and acts 4–5 are genuinely rejected by the contract.
 */

import { ContractService } from "../contracts/ContractService.ts";
import { eventStore } from "../store/scenarios.ts";
import { REASONS } from "../agent/constants.ts";
import { log } from "../lib/logger.ts";
import type { ScenarioResult } from "../types/scenario.ts";
import type { DemoSummary } from "./DemoRunner.ts";

/** On-chain amounts (MON) sized to the deployed policy limits. */
const ONCHAIN_AMOUNTS = {
  safePayment: "0.001",
  escrow: "0.002",
  injection: "0.001", // small enough to pass amount checks; blocked on phrase
  overspend: "0.02", // exceeds maxPerPayment (0.01) -> blocked
} as const;

export interface OnChainDemoResult {
  summary: DemoSummary;
  events: ScenarioResult[];
}

/** Build a runner from env, or undefined if the chain isn't configured. */
export function tryBuildOnChainRunner(): OnChainDemoRunner | undefined {
  if (process.env.MOCK_CHAIN === "true") return undefined;
  if (!process.env.RPC_URL || !process.env.AGENT_VAULT_ADDRESS) return undefined;
  if (!process.env.PRIVATE_KEY_AGENT || !process.env.PRIVATE_KEY_VERIFIER) return undefined;
  try {
    return new OnChainDemoRunner(ContractService.fromEnv());
  } catch (err) {
    log.warn("onchain.build_failed", { error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

export class OnChainDemoRunner {
  /**
   * Serializes on-chain runs process-wide. All runs share one agent wallet, so
   * overlapping runs would reuse the same nonce ("existing transaction had
   * higher priority"). This chain guarantees one run submits at a time.
   */
  private static queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly svc: ContractService) {}

  /** The recipient ("API provider") — an allowlisted address. */
  private get apiProvider(): string {
    const a = process.env.DEMO_API_PROVIDER_ADDRESS;
    if (!a) throw new Error("OnChainDemoRunner: DEMO_API_PROVIDER_ADDRESS not set.");
    return a;
  }

  /** The verifier — allowlisted, and the signer that approves/releases escrow. */
  private get verifier(): string {
    return process.env.DEMO_VERIFIER_ADDRESS || this.svc.verifierAddress;
  }

  /** Run, serialized behind any in-flight run (see {@link OnChainDemoRunner.queue}). */
  run(): Promise<OnChainDemoResult> {
    const next = OnChainDemoRunner.queue.then(() => this.execute());
    // Keep the queue chained regardless of this run's success/failure.
    OnChainDemoRunner.queue = next.catch(() => undefined);
    return next;
  }

  private async execute(): Promise<OnChainDemoResult> {
    const events: ScenarioResult[] = [];

    // Act 1 — safe payment -> APPROVED
    events.push(
      ...(await this.svc.requestPayment(
        this.apiProvider,
        ONCHAIN_AMOUNTS.safePayment,
        "PAYMENT",
        REASONS.safePayment,
      )).results,
    );

    // Act 2 — create escrow -> ESCROW_CREATED
    const escrowTaskId = this.svc.newTaskId("escrow");
    const createRes = await this.svc.createEscrow(
      this.verifier,
      ONCHAIN_AMOUNTS.escrow,
      REASONS.escrowCreate,
      escrowTaskId,
    );
    events.push(...createRes.results);
    const created = createRes.results.some((r) => r.status === "ESCROW_CREATED");

    // Act 3 — approve + release escrow -> ESCROW_RELEASED.
    // Only if the escrow was actually created (otherwise the contract blocked
    // it and there is nothing to release). Retry transient ESCROW_NOT_FOUND
    // reverts caused by Monad's load-balanced RPC nodes lagging on fresh state.
    if (created) {
      await this.withRetry(() => this.svc.approveEscrow(escrowTaskId));
      const releaseRes = await this.withRetry(() => this.svc.releaseEscrow(escrowTaskId));
      events.push(...releaseRes.results);
    }

    // Act 4 — prompt-injection attack -> BLOCKED (ON_CHAIN_INJECTION_PATTERN)
    events.push(
      ...(await this.svc.requestPayment(
        this.apiProvider,
        ONCHAIN_AMOUNTS.injection,
        "TRANSFER",
        REASONS.promptInjection,
      )).results,
    );

    // Act 5 — overspend attack -> BLOCKED (MAX_PER_PAYMENT_EXCEEDED)
    events.push(
      ...(await this.svc.requestPayment(
        this.apiProvider,
        ONCHAIN_AMOUNTS.overspend,
        "PAYMENT",
        REASONS.overspend,
      )).results,
    );

    // Persist to the audit store so /events reflects this run immediately.
    // (EventSyncService may also ingest the same events live; dedup by taskId.)
    for (const e of events) {
      if (!eventStore.getEventByTaskId(e.taskId)) {
        try {
          eventStore.addEvent(e);
        } catch {
          /* raced with EventSync — already stored */
        }
      }
    }

    return { summary: summarize(events), events };
  }

  /** Retry a tx a few times when fresh on-chain state hasn't propagated yet. */
  private async withRetry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 1500): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!/ESCROW_NOT_FOUND|NOT_APPROVED|could not coalesce|timeout/i.test(msg)) throw err;
        log.warn("onchain.retry", { attempt: i + 1, error: msg.slice(0, 120) });
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  }
}

function summarize(events: ScenarioResult[]): DemoSummary {
  let approvedPayments = 0;
  let blockedPayments = 0;
  let escrowOperations = 0;
  for (const e of events) {
    if (e.status === "APPROVED") approvedPayments++;
    else if (e.status === "BLOCKED") blockedPayments++;
    else if (e.status === "ESCROW_CREATED" || e.status === "ESCROW_RELEASED") escrowOperations++;
  }
  return { approvedPayments, blockedPayments, escrowOperations, totalEvents: events.length };
}
