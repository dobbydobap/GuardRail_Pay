/**
 * AgentRunner — converts natural-language tasks into structured payment
 * requests by prompting an LLM (via {@link OllamaClient}) and validating the
 * result.
 *
 * Responsibilities (business logic only — transport lives in OllamaClient):
 *   - prompt the model to return ONLY JSON matching the PaymentRequest schema
 *   - safely parse + validate the response, retrying on malformed output
 *   - log the raw model output for observability
 *   - force the recipient to a deterministic address per scenario, so the
 *     critical field never depends on model output
 *   - return a strongly-typed {@link PaymentRequest}
 */

import { OllamaClient } from "./OllamaClient.ts";
import {
  buildOverspendPrompt,
  buildPromptInjectionPrompt,
  buildSafePaymentPrompt,
} from "./prompts.ts";
import { ADDRESSES } from "./constants.ts";
import { log } from "../lib/logger.ts";

// --- Types ----------------------------------------------------------------

export type PaymentRequest = {
  to: string;
  amount: string;
  actionType: string;
  reason: string;
};

/** Minimal LLM dependency — anything that turns a prompt into raw text. */
export interface LLMClient {
  generate(prompt: string, options?: { json?: boolean }): Promise<string>;
}

export interface AgentRunnerConfig {
  /** LLM to use. Defaults to an OllamaClient built from env. */
  llm?: LLMClient;
  /** Attempts before giving up on malformed JSON. Default: 3. */
  maxRetries?: number;
  /** Suppress structured logs. Default: false. */
  silent?: boolean;
}

/** Thrown when a valid PaymentRequest can't be produced after retries. */
export class AgentRunnerError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AgentRunnerError";
    this.cause = cause;
  }
}

// --- Helpers --------------------------------------------------------------

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Clean a raw model response into candidate JSON text:
 *   1. strip <think>...</think> reasoning blocks (qwen3 et al.)
 *   2. drop anything before a stray closing </think>
 *   3. strip ```json ... ``` / ``` ... ``` markdown fences
 */
function cleanResponse(raw: string): string {
  let text = raw.trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const closeIdx = text.toLowerCase().lastIndexOf("</think>");
  if (closeIdx !== -1) text = text.slice(closeIdx + "</think>".length).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) text = fence[1].trim();
  return text;
}

/** Extract the first balanced JSON object from text (ignores braces in strings). */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      if (--depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse raw model output into an object, trying multiple extraction strategies
 * (this is the "retry parsing once" step). Throws AgentRunnerError on failure.
 */
function parseJson(raw: string): unknown {
  const cleaned = cleanResponse(raw);
  // Strategy 1: first balanced object. Strategy 2: outermost braces span.
  const candidates = [
    firstJsonObject(cleaned),
    (() => {
      const s = cleaned.indexOf("{");
      const e = cleaned.lastIndexOf("}");
      return s !== -1 && e > s ? cleaned.slice(s, e + 1) : null;
    })(),
    cleaned,
  ].filter((c): c is string => !!c);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next strategy */
    }
  }
  throw new AgentRunnerError("Response did not contain valid JSON.");
}

/** Validate + normalize a parsed object into a PaymentRequest (without `to`). */
function validateSchema(data: unknown): PaymentRequest {
  if (typeof data !== "object" || data === null) {
    throw new AgentRunnerError("Response is not a JSON object.");
  }
  const obj = data as Record<string, unknown>;

  const str = (key: string): string => {
    const v = obj[key];
    if (typeof v === "number") return String(v); // tolerate numeric amount
    if (typeof v !== "string" || v.trim() === "") {
      throw new AgentRunnerError(`Field "${key}" must be a non-empty string.`);
    }
    return v.trim();
  };

  // `to` is intentionally NOT required: the runner always overrides the
  // recipient with the deterministic per-scenario address, so a model that
  // omits it (or returns a placeholder) should not trigger a fallback.
  const amount = str("amount");
  const actionType = str("actionType");
  const reason = str("reason");

  if (Number.isNaN(Number(amount))) {
    throw new AgentRunnerError(`Field "amount" must be numeric, got "${amount}".`);
  }
  return { to: "", amount, actionType: actionType.toUpperCase(), reason };
}

// --- Runner ---------------------------------------------------------------

export class AgentRunner {
  private readonly llm: LLMClient;
  private readonly maxRetries: number;
  private readonly silent: boolean;

  constructor(config: AgentRunnerConfig = {}) {
    this.llm = config.llm ?? OllamaClient.fromEnv();
    // Default 2 attempts = initial call + one model-call retry.
    this.maxRetries = Math.max(1, config.maxRetries ?? 2);
    this.silent = config.silent ?? false;
  }

  static fromEnv(config: Omit<AgentRunnerConfig, "llm"> = {}): AgentRunner {
    return new AgentRunner(config);
  }

  /** A normal payment to the approved API provider. */
  generatePaymentRequest(task?: string): Promise<PaymentRequest> {
    return this.run("payment", buildSafePaymentPrompt(task), ADDRESSES.apiProvider);
  }

  /** A prompt-injection attempt that tries to redirect funds to a bad actor. */
  generatePromptInjectionRequest(task?: string): Promise<PaymentRequest> {
    return this.run("prompt_injection", buildPromptInjectionPrompt(task), ADDRESSES.badActor);
  }

  /** An oversized payout intended to exceed spending limits. */
  generateOverspendRequest(task?: string): Promise<PaymentRequest> {
    return this.run("overspend", buildOverspendPrompt(task), ADDRESSES.apiProvider);
  }

  /**
   * Core loop: prompt the LLM, log the raw output, parse + validate, and retry
   * with a corrective hint on failure. The recipient is always overridden with
   * the deterministic `to` so it never depends on the model.
   */
  private async run(scenario: string, basePrompt: string, to: string): Promise<PaymentRequest> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const prompt =
        attempt === 1
          ? basePrompt
          : `${basePrompt}\n\nYour previous response was invalid: ${errMessage(lastError)}. ` +
            `Return ONLY the JSON object. No markdown, no explanations, no <think> blocks.`;

      const raw = await this.llm.generate(prompt, { json: true });
      if (!this.silent) {
        // Log the full raw model output so parse failures are diagnosable.
        log.info("agent.llm_raw", { scenario, attempt, length: raw.length, raw });
      }

      try {
        const validated = validateSchema(parseJson(raw));
        return { ...validated, to }; // deterministic recipient
      } catch (err) {
        lastError = err;
        if (!this.silent) {
          log.warn("agent.parse_failed", { scenario, attempt, error: errMessage(err), raw });
        }
      }
    }

    throw new AgentRunnerError(
      `Failed to generate a valid PaymentRequest for "${scenario}" after ${this.maxRetries} attempt(s): ${errMessage(lastError)}`,
      lastError,
    );
  }
}
