/**
 * Connectivity probes for the health endpoint.
 *
 * Every probe is timeout-bounded and swallows its own errors, returning a
 * boolean — so /health can never hang or throw regardless of the state of the
 * RPC node, contract, or Ollama endpoint.
 */

import { JsonRpcProvider } from "ethers";
import { log } from "../lib/logger.ts";

const PROBE_TIMEOUT_MS = 3000;

/** Resolve a promise or reject after `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface Connectivity {
  rpcConnected: boolean;
  contractConnected: boolean;
  ollamaConnected: boolean;
}

/** RPC reachable + (optionally) contract code present at the vault address. */
async function checkChain(): Promise<{ rpc: boolean; contract: boolean }> {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) return { rpc: false, contract: false };

  const provider = new JsonRpcProvider(rpcUrl);
  try {
    await withTimeout(provider.getBlockNumber(), PROBE_TIMEOUT_MS);
    const rpc = true;

    let contract = false;
    const address = process.env.AGENT_VAULT_ADDRESS;
    if (address) {
      const code = await withTimeout(provider.getCode(address), PROBE_TIMEOUT_MS);
      contract = code !== undefined && code !== "0x";
    }
    return { rpc, contract };
  } catch (err) {
    log.warn("health.rpc_unreachable", { error: err instanceof Error ? err.message : String(err) });
    return { rpc: false, contract: false };
  } finally {
    provider.destroy();
  }
}

/**
 * Ollama OpenAI-compatible endpoint reachable AND the configured model is
 * actually served (GET <base>/models, then confirm OLLAMA_MODEL is listed).
 *
 * Confirming the model — not just reachability — is deliberate: a bad model id
 * (e.g. "qwen3:32b" not on the account) leaves /models returning 200 while
 * every chat completion 404s, which previously made health report green while
 * the demo silently fell back. ollamaConnected now means "the demo can use it".
 */
async function checkOllama(): Promise<boolean> {
  const base = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_MODEL;
  if (!base || !model) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (process.env.OLLAMA_API_KEY) headers.authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
    const res = await fetch(`${base.replace(/\/$/, "")}/models`, { headers, signal: controller.signal });
    if (!res.ok) return false;

    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const available = (body.data ?? []).map((m) => m.id);
    const ok = available.includes(model);
    if (!ok) {
      log.warn("health.ollama_model_missing", { model, availableCount: available.length });
    }
    return ok;
  } catch (err) {
    log.warn("health.ollama_unreachable", { error: err instanceof Error ? err.message : String(err) });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Run all probes in parallel; always resolves, never throws. */
export async function checkConnectivity(): Promise<Connectivity> {
  const [chain, ollamaConnected] = await Promise.all([checkChain(), checkOllama()]);
  return {
    rpcConnected: chain.rpc,
    contractConnected: chain.contract,
    ollamaConnected,
  };
}
