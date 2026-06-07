/**
 * EventSyncService — keeps the in-memory {@link EventStore} in sync with the
 * AgentVault contract (ethers v6).
 *
 * It listens for:
 *   PaymentApproved, PaymentBlocked, EscrowCreated, EscrowReleased, AgentFrozen
 *
 * Each event is decoded into a canonical {@link ScenarioResult} and pushed into
 * the store automatically. Duplicate processing is prevented with a
 * deterministic dedup key (`txHash:logIndex`) so a startup replay overlapping
 * the live stream — or a reconnect/re-org — never double-counts an event.
 *
 * On start it can replay the last N blocks so the store is warm immediately.
 *
 * Decoding/listening uses the vault Contract + provider from a
 * {@link ContractService}; this service owns the sync concerns (dedup, replay,
 * store integration, stats).
 */

import { formatEther, type ContractEventPayload, type Log } from "ethers";

import { ContractService } from "./ContractService.ts";
import { eventStore } from "../store/scenarios.ts";
import { ActionType, type EventStore, type ScenarioResult, type ScenarioStatus } from "../types/scenario.ts";

// --- Event → ScenarioResult mapping --------------------------------------

interface EventMapping {
  status: ScenarioStatus;
  actionType: string;
  /** Which event arg carries the human-readable reason. */
  reasonArg: string;
  /** `"FROM_REASON"` = use the reasonArg value; a string = static code; null = none. */
  blockReason: "FROM_REASON" | string | null;
}

const EVENT_MAP: Record<string, EventMapping> = {
  PaymentApproved: { status: "APPROVED", actionType: ActionType.PAYMENT, reasonArg: "reason", blockReason: null },
  PaymentBlocked: { status: "BLOCKED", actionType: ActionType.PAYMENT, reasonArg: "blockReason", blockReason: "FROM_REASON" },
  EscrowCreated: { status: "ESCROW_CREATED", actionType: ActionType.ESCROW_CREATE, reasonArg: "reason", blockReason: null },
  EscrowReleased: { status: "ESCROW_RELEASED", actionType: ActionType.ESCROW_RELEASE, reasonArg: "reason", blockReason: null },
  AgentFrozen: { status: "BLOCKED", actionType: "FREEZE", reasonArg: "reason", blockReason: "AGENT_FROZEN" },
};

const EVENT_NAMES = Object.keys(EVENT_MAP);

// --- Config / stats -------------------------------------------------------

export interface EventSyncOptions {
  contract?: ContractService;
  store?: EventStore;
  /** Blocks to replay on start (0 disables replay). Default: 5000. */
  replayBlocks?: number;
}

export interface EventSyncStats {
  running: boolean;
  ingested: number;
  duplicates: number;
  replayed: number;
  lastEventAt?: number;
}

// --- Service --------------------------------------------------------------

export class EventSyncService {
  private readonly contract: ContractService;
  private readonly store: EventStore;
  private readonly replayBlocks: number;

  /** Deterministic dedup keys (`txHash:logIndex`) already processed. */
  private readonly processed = new Set<string>();
  private readonly blockTimeCache = new Map<number, number>();

  private unsubscribe?: () => Promise<void>;
  private running = false;
  private ingested = 0;
  private duplicates = 0;
  private replayed = 0;
  private lastEventAt?: number;

  constructor(options: EventSyncOptions = {}) {
    this.contract = options.contract ?? ContractService.fromEnv();
    this.store = options.store ?? eventStore;
    this.replayBlocks = options.replayBlocks ?? 5000;
  }

  static fromEnv(options: Omit<EventSyncOptions, "contract"> = {}): EventSyncService {
    return new EventSyncService({ ...options, contract: ContractService.fromEnv() });
  }

  get isRunning(): boolean {
    return this.running;
  }

  getStats(): EventSyncStats {
    return {
      running: this.running,
      ingested: this.ingested,
      duplicates: this.duplicates,
      replayed: this.replayed,
      lastEventAt: this.lastEventAt,
    };
  }

  /**
   * Replay the last N blocks (if configured) and then attach live listeners.
   * Idempotent: a second call while running is a no-op.
   */
  async start(): Promise<void> {
    if (this.running) return;

    if (this.replayBlocks > 0) {
      await this.replay(this.replayBlocks);
    }
    this.attachListeners();
    this.running = true;
    console.log(`👂 EventSyncService live on AgentVault @ ${this.contract.address}`);
  }

  /** Detach live listeners. Idempotent. */
  async stop(): Promise<void> {
    if (!this.running) return;
    await this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.running = false;
    console.log("🛑 EventSyncService stopped.");
  }

  // --- Replay -------------------------------------------------------------

  private async replay(blocks: number): Promise<void> {
    const latest = await this.contract.provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - blocks);

    const logs: Log[] = [];
    for (const name of EVENT_NAMES) {
      const found = await this.contract.vault.queryFilter(name, fromBlock, latest);
      logs.push(...(found as Log[]));
    }
    // Process in chain order so the store reflects on-chain sequence.
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

    for (const log of logs) {
      const result = await this.decode(log);
      if (result && this.ingest(log, result)) this.replayed++;
    }
    console.log(`📜 EventSyncService replayed ${this.replayed} event(s) from block ${fromBlock}→${latest}.`);
  }

  // --- Live listeners -----------------------------------------------------

  private attachListeners(): void {
    for (const name of EVENT_NAMES) {
      // ethers v6: (...eventArgs, ContractEventPayload). We re-decode the log.
      this.contract.vault.on(name, (...listenerArgs: unknown[]) => {
        void this.handleLive(listenerArgs[listenerArgs.length - 1] as ContractEventPayload);
      });
    }
    this.unsubscribe = async () => {
      for (const name of EVENT_NAMES) await this.contract.vault.off(name);
    };
  }

  private async handleLive(payload: ContractEventPayload): Promise<void> {
    try {
      const result = await this.decode(payload.log);
      if (result) this.ingest(payload.log, result);
    } catch (err) {
      console.error("EventSyncService: failed to handle event", err);
    }
  }

  // --- Decode -------------------------------------------------------------

  /** Decode a log into a ScenarioResult, or null if it isn't a tracked event. */
  private async decode(log: Log): Promise<ScenarioResult | null> {
    let parsed;
    try {
      parsed = this.contract.vault.interface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      return null;
    }
    if (!parsed) return null;

    const mapping = EVENT_MAP[parsed.name];
    if (!mapping) return null;

    const args = parsed.args as unknown as Record<string, unknown>;
    const reason = (args[mapping.reasonArg] as string | undefined) ?? parsed.name;

    let blockReason: string | null = null;
    if (mapping.blockReason === "FROM_REASON") blockReason = reason;
    else if (typeof mapping.blockReason === "string") blockReason = mapping.blockReason;

    // taskId: prefer the event's natural id; otherwise a deterministic key so
    // the same on-chain event always yields the same taskId (dedup-friendly).
    const idArg = (args.taskId ?? args.escrowId) as string | undefined;
    const taskId = idArg ?? this.dedupKey(log);

    return {
      taskId,
      agent: String(args.agent ?? ""),
      to: String(args.to ?? ""),
      amount: formatEther((args.amount ?? 0n) as bigint),
      actionType: mapping.actionType,
      reason,
      status: mapping.status,
      blockReason,
      txHash: log.transactionHash,
      timestamp: await this.blockTime(log.blockNumber),
    };
  }

  // --- Ingest / dedup -----------------------------------------------------

  /** Returns true if the result was newly stored, false if it was a duplicate. */
  private ingest(log: Log, result: ScenarioResult): boolean {
    const key = this.dedupKey(log);
    if (this.processed.has(key) || this.store.getEventByTaskId(result.taskId)) {
      this.duplicates++;
      return false;
    }
    this.processed.add(key);
    try {
      this.store.addEvent(result);
      this.ingested++;
      this.lastEventAt = Date.now();
      return true;
    } catch {
      // Lost a race (same taskId inserted elsewhere).
      this.duplicates++;
      return false;
    }
  }

  private dedupKey(log: Log): string {
    return `${log.transactionHash}:${log.index}`;
  }

  private async blockTime(blockNumber: number): Promise<number> {
    const cached = this.blockTimeCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await this.contract.provider.getBlock(blockNumber).catch(() => null);
    const ms = block ? block.timestamp * 1000 : Date.now();
    this.blockTimeCache.set(blockNumber, ms);
    return ms;
  }
}

/**
 * Start an EventSyncService only if the chain is configured. Safe to call at
 * boot: returns undefined (and logs) when env is missing, keeping the app in
 * mock-only mode.
 */
export async function startEventSyncIfConfigured(
  options: Omit<EventSyncOptions, "contract"> = {},
): Promise<EventSyncService | undefined> {
  if (!process.env.RPC_URL || !process.env.AGENT_VAULT_ADDRESS) {
    console.log("ℹ️  EventSyncService disabled (RPC_URL / AGENT_VAULT_ADDRESS not set).");
    return undefined;
  }
  try {
    const service = EventSyncService.fromEnv(options);
    await service.start();
    return service;
  } catch (err) {
    console.error("⚠️  EventSyncService failed to start:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
