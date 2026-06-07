/**
 * ContractService — on-chain client for AgentVault + AgentRegistry (ethers v6).
 *
 * Two signers:
 *   - agent    (PRIVATE_KEY_AGENT)    signs requestPayment / createEscrow
 *   - verifier (PRIVATE_KEY_VERIFIER) signs releaseEscrow
 *
 * Write methods wait for the receipt and return `{ txHash, receipt, status }`
 * (plus the decoded `results`). Emitted contract events are mapped into
 * canonical {@link ScenarioResult} objects, both per-transaction and via the
 * live {@link listenForEvents} subscription.
 *
 * Environment:
 *   RPC_URL                JSON-RPC endpoint (required)
 *   PRIVATE_KEY_AGENT      agent signer key (required for agent writes)
 *   PRIVATE_KEY_VERIFIER   verifier signer key (required for releaseEscrow)
 *   AGENT_VAULT_ADDRESS    deployed AgentVault address (required)
 *   AGENT_REGISTRY_ADDRESS deployed AgentRegistry address (required)
 *   CHAIN_ID               optional chainId hint
 *   AGENT_VAULT_ABI_PATH / AGENT_REGISTRY_ABI_PATH   optional ABI overrides
 */

import { readFileSync } from "node:fs";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  parseEther,
  type ContractEventPayload,
  type InterfaceAbi,
  type Log,
  type TransactionReceipt,
} from "ethers";

import { generateTaskId } from "../lib/generators.ts";
import {
  ActionType,
  type ScenarioResult,
  type ScenarioStatus,
} from "../types/scenario.ts";

// --- Config ---------------------------------------------------------------

export interface ContractServiceConfig {
  rpcUrl?: string;
  vaultAddress?: string;
  registryAddress?: string;
  agentKey?: string;
  verifierKey?: string;
  vaultAbi?: InterfaceAbi;
  registryAbi?: InterfaceAbi;
  chainId?: number;
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`ContractService: missing required env var ${name}`);
  return value;
}

function loadAbi(explicit: InterfaceAbi | undefined, envPath: string | undefined, file: string): InterfaceAbi {
  if (explicit) return explicit;
  const target = envPath ?? new URL(`./${file}`, import.meta.url);
  return JSON.parse(readFileSync(target, "utf8")) as InterfaceAbi;
}

// --- Result shape ---------------------------------------------------------

/** Returned by every write method. */
export interface TxResult {
  txHash: string;
  receipt: TransactionReceipt;
  /** Outcome: a ScenarioStatus from the emitted event, or SUCCESS/REVERTED. */
  status: string;
  /** ScenarioResults decoded from the events this transaction emitted. */
  results: ScenarioResult[];
}

/** Maps a contract event name onto the ScenarioResult fields it implies. */
const EVENT_MAP: Record<
  string,
  { status: ScenarioStatus; actionType: ActionType; reasonArg: string; isBlock?: boolean }
> = {
  PaymentApproved: { status: "APPROVED", actionType: ActionType.PAYMENT, reasonArg: "reason" },
  PaymentBlocked: { status: "BLOCKED", actionType: ActionType.PAYMENT, reasonArg: "blockReason", isBlock: true },
  EscrowCreated: { status: "ESCROW_CREATED", actionType: ActionType.ESCROW_CREATE, reasonArg: "reason" },
  EscrowReleased: { status: "ESCROW_RELEASED", actionType: ActionType.ESCROW_RELEASE, reasonArg: "reason" },
};

// --- Service --------------------------------------------------------------

export class ContractService {
  readonly provider: JsonRpcProvider;
  readonly address: string;
  readonly registryAddress: string;

  /** Read/listen instance (provider-backed). */
  readonly vault: Contract;
  readonly registry: Contract;

  private readonly agentWallet?: Wallet;
  private readonly verifierWallet?: Wallet;
  private readonly blockTimeCache = new Map<number, number>();

  constructor(config: ContractServiceConfig = {}) {
    const rpcUrl = requireEnv(config.rpcUrl ?? process.env.RPC_URL, "RPC_URL");
    this.address = requireEnv(config.vaultAddress ?? process.env.AGENT_VAULT_ADDRESS, "AGENT_VAULT_ADDRESS");
    this.registryAddress = requireEnv(
      config.registryAddress ?? process.env.AGENT_REGISTRY_ADDRESS,
      "AGENT_REGISTRY_ADDRESS",
    );

    const chainId = config.chainId ?? (process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined);
    this.provider = new JsonRpcProvider(rpcUrl, chainId);

    const agentKey = config.agentKey ?? process.env.PRIVATE_KEY_AGENT;
    const verifierKey = config.verifierKey ?? process.env.PRIVATE_KEY_VERIFIER;
    if (agentKey) this.agentWallet = new Wallet(agentKey, this.provider);
    if (verifierKey) this.verifierWallet = new Wallet(verifierKey, this.provider);

    const vaultAbi = loadAbi(config.vaultAbi, process.env.AGENT_VAULT_ABI_PATH, "AgentVault.abi.json");
    const registryAbi = loadAbi(config.registryAbi, process.env.AGENT_REGISTRY_ABI_PATH, "AgentRegistry.abi.json");

    this.vault = new Contract(this.address, vaultAbi, this.provider);
    this.registry = new Contract(this.registryAddress, registryAbi, this.provider);
  }

  static fromEnv(): ContractService {
    return new ContractService();
  }

  private vaultAs(wallet: Wallet | undefined, role: string): Contract {
    if (!wallet) throw new Error(`ContractService: PRIVATE_KEY_${role} is required for this transaction.`);
    return this.vault.connect(wallet) as Contract;
  }

  // --- Writes -------------------------------------------------------------

  /** Submit a payment request (signed by the agent). */
  async requestPayment(to: string, amount: string | number, memo = ""): Promise<TxResult> {
    const vault = this.vaultAs(this.agentWallet, "AGENT");
    const tx = await vault.getFunction("requestPayment")(to, parseEther(String(amount)), memo);
    return this.settle(tx);
  }

  /** Open an escrow (signed by the agent). */
  async createEscrow(to: string, amount: string | number, memo = ""): Promise<TxResult> {
    const vault = this.vaultAs(this.agentWallet, "AGENT");
    const tx = await vault.getFunction("createEscrow")(to, parseEther(String(amount)), memo);
    return this.settle(tx);
  }

  /** Release an escrow by id (signed by the verifier). */
  async releaseEscrow(escrowId: string): Promise<TxResult> {
    const vault = this.vaultAs(this.verifierWallet, "VERIFIER");
    const tx = await vault.getFunction("releaseEscrow")(escrowId);
    return this.settle(tx);
  }

  /** Wait for the tx to mine, decode its events, and assemble the result. */
  private async settle(tx: { hash: string; wait: () => Promise<TransactionReceipt | null> }): Promise<TxResult> {
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`Transaction ${tx.hash} was not mined (null receipt).`);

    const results = await this.decodeReceipt(receipt);
    const status = results[0]?.status ?? (receipt.status === 1 ? "SUCCESS" : "REVERTED");
    return { txHash: receipt.hash, receipt, status, results };
  }

  // --- Event decoding -----------------------------------------------------

  /** Decode every recognized AgentVault event in a receipt into ScenarioResults. */
  async decodeReceipt(receipt: TransactionReceipt): Promise<ScenarioResult[]> {
    const out: ScenarioResult[] = [];
    for (const log of receipt.logs) {
      const result = await this.logToScenarioResult(log, receipt.hash);
      if (result) out.push(result);
    }
    return out;
  }

  /** Convert a single emitted log into a ScenarioResult, or null if unknown. */
  async logToScenarioResult(log: Log, txHash?: string): Promise<ScenarioResult | null> {
    let parsed;
    try {
      parsed = this.vault.interface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      return null;
    }
    if (!parsed) return null;

    const mapping = EVENT_MAP[parsed.name];
    if (!mapping) return null;

    const args = parsed.args as unknown as Record<string, unknown> & ArrayLike<unknown>;
    const idArg = (args.taskId ?? args.escrowId ?? args[0]) as string | undefined;
    const reason = (args[mapping.reasonArg] as string | undefined) ?? parsed.name;

    return {
      taskId: idArg ?? generateTaskId(),
      agent: String(args.agent ?? ""),
      to: String(args.to ?? ""),
      amount: formatEther((args.amount ?? 0n) as bigint),
      actionType: mapping.actionType,
      reason,
      status: mapping.status,
      blockReason: mapping.isBlock ? reason : null,
      txHash: txHash ?? log.transactionHash,
      timestamp: await this.blockTime(log.blockNumber),
    };
  }

  /** Resolve a block's timestamp (ms), cached; falls back to now() on miss. */
  private async blockTime(blockNumber: number): Promise<number> {
    const cached = this.blockTimeCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await this.provider.getBlock(blockNumber).catch(() => null);
    const ms = block ? block.timestamp * 1000 : Date.now();
    this.blockTimeCache.set(blockNumber, ms);
    return ms;
  }

  // --- Live subscription --------------------------------------------------

  /**
   * Subscribe to AgentVault events; each is delivered as a ScenarioResult.
   * Returns an async unsubscribe function.
   */
  listenForEvents(onResult: (result: ScenarioResult) => void): () => Promise<void> {
    const handler = async (payload: ContractEventPayload) => {
      try {
        const result = await this.logToScenarioResult(payload.log);
        if (result) onResult(result);
      } catch (err) {
        console.error("ContractService: failed to handle event", err);
      }
    };

    const eventNames = Object.keys(EVENT_MAP);
    for (const name of eventNames) {
      this.vault.on(name, (...listenerArgs: unknown[]) => {
        void handler(listenerArgs[listenerArgs.length - 1] as ContractEventPayload);
      });
    }

    return async () => {
      for (const name of eventNames) await this.vault.off(name);
    };
  }
}
