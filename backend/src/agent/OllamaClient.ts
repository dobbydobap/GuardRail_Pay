/**
 * OllamaClient — a thin, OpenAI-compatible client for Ollama Cloud.
 *
 * This is pure transport: it sends a prompt and returns the raw model output as
 * a string. It contains NO business logic (no schema parsing, no payment
 * concepts) — callers layer that on top.
 *
 * Features: configurable per-request timeout, up to 3 retries with backoff on
 * transient failures, structured JSON logging, typed errors, and JSON mode.
 *
 * Environment:
 *   OLLAMA_API_KEY    API key
 *   OLLAMA_BASE_URL   OpenAI-compatible endpoint (e.g. https://ollama.com/v1)
 *   OLLAMA_MODEL      model id (e.g. "gpt-oss:120b")
 *   OLLAMA_TIMEOUT_MS optional per-request timeout (default 30000)
 */

import OpenAI from "openai";

// --- Types ----------------------------------------------------------------

export interface OllamaClientConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** Per-request timeout in ms. Default: 30000. */
  timeoutMs?: number;
  /** Max attempts (initial + retries), capped at 3. Default: 3. */
  maxRetries?: number;
  /** Sampling temperature. Default: 0. */
  temperature?: number;
  /** Suppress structured logs. Default: false. */
  silent?: boolean;
  /** Inject a preconfigured OpenAI client (used for testing). */
  client?: OpenAI;
}

export interface GenerateOptions {
  /** Request JSON mode (sets response_format = json_object). */
  json?: boolean;
  /** Override temperature for this call. */
  temperature?: number;
  /** Override timeout (ms) for this call. */
  timeoutMs?: number;
  /** Override model for this call. */
  model?: string;
  /** External abort signal (cancels without retrying). */
  signal?: AbortSignal;
}

/** Error thrown when a request ultimately fails (after retries) or config is bad. */
export class OllamaClientError extends Error {
  readonly status?: number;
  readonly attempts: number;
  override readonly cause?: unknown;

  constructor(message: string, opts: { status?: number; attempts?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "OllamaClientError";
    this.status = opts.status;
    this.attempts = opts.attempts ?? 0;
    this.cause = opts.cause;
  }
}

type LogLevel = "info" | "warn" | "error";

// --- Helpers --------------------------------------------------------------

const MAX_RETRIES_CAP = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function requireConfig(value: string | undefined, name: string): string {
  if (!value) throw new OllamaClientError(`Missing required configuration: ${name}`);
  return value;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

function isAbort(err: unknown): boolean {
  return (
    (err as { name?: string } | null)?.name === "AbortError" ||
    err instanceof OpenAI.APIUserAbortError
  );
}

/** Transient failures worth retrying: timeouts, network errors, 429, and 5xx. */
function isRetryable(err: unknown, timedOut: boolean): boolean {
  if (timedOut) return true;
  if (isAbort(err)) return false; // external cancel
  const status = statusOf(err);
  if (status === undefined) return true; // network/transport error
  return status === 429 || status >= 500;
}

// --- Client ---------------------------------------------------------------

export class OllamaClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number;
  private readonly silent: boolean;

  constructor(config: OllamaClientConfig = {}) {
    this.model = config.model ?? requireConfig(process.env.OLLAMA_MODEL, "OLLAMA_MODEL");
    this.timeoutMs =
      config.timeoutMs ??
      (process.env.OLLAMA_TIMEOUT_MS ? Number(process.env.OLLAMA_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS);
    this.maxRetries = Math.max(1, Math.min(config.maxRetries ?? MAX_RETRIES_CAP, MAX_RETRIES_CAP));
    this.temperature = config.temperature ?? 0;
    this.silent = config.silent ?? false;

    this.client =
      config.client ??
      new OpenAI({
        apiKey: config.apiKey ?? requireConfig(process.env.OLLAMA_API_KEY, "OLLAMA_API_KEY"),
        baseURL: config.baseURL ?? requireConfig(process.env.OLLAMA_BASE_URL, "OLLAMA_BASE_URL"),
        // We manage retries ourselves; disable the SDK's internal retrying.
        maxRetries: 0,
      });
  }

  static fromEnv(config: Omit<OllamaClientConfig, "client"> = {}): OllamaClient {
    return new OllamaClient(config);
  }

  /**
   * Send `prompt` to the model and return the raw output string.
   *
   * @throws {OllamaClientError} after exhausting retries, or on external abort.
   */
  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const model = options.model ?? this.model;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const temperature = options.temperature ?? this.temperature;

    const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    };

    let lastError: unknown;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      attemptsMade = attempt;
      const startedAt = Date.now();
      const controller = new AbortController();
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onExternalAbort = () => controller.abort();
      options.signal?.addEventListener("abort", onExternalAbort, { once: true });

      this.log("info", "request.start", { model, attempt, maxRetries: this.maxRetries, json: !!options.json });

      try {
        const completion = await this.client.chat.completions.create(body, {
          signal: controller.signal,
        });
        const content = completion.choices[0]?.message?.content ?? "";
        this.log("info", "request.success", {
          model,
          attempt,
          ms: Date.now() - startedAt,
          length: content.length,
        });
        return content; // raw model output
      } catch (err) {
        lastError = err;
        const ms = Date.now() - startedAt;
        const status = statusOf(err);

        // External cancellation: do not retry.
        if (isAbort(err) && !timedOut) {
          this.log("warn", "request.aborted", { model, attempt, ms });
          throw new OllamaClientError("Request aborted by caller.", { status, attempts: attempt, cause: err });
        }

        const retryable = isRetryable(err, timedOut);
        this.log(retryable ? "warn" : "error", timedOut ? "request.timeout" : "request.error", {
          model,
          attempt,
          ms,
          status,
          retryable,
          error: errMessage(err),
        });

        if (!retryable || attempt >= this.maxRetries) break;
        await sleep(250 * 2 ** (attempt - 1)); // 250ms, 500ms, ...
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onExternalAbort);
      }
    }

    throw new OllamaClientError(
      `Ollama request failed after ${attemptsMade} attempt(s): ${errMessage(lastError)}`,
      { status: statusOf(lastError), attempts: attemptsMade, cause: lastError },
    );
  }

  // --- Structured logging -------------------------------------------------

  private log(level: LogLevel, event: string, fields: Record<string, unknown>): void {
    if (this.silent) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: "OllamaClient",
      event,
      ...fields,
    });
    if (level === "error") console.error(line);
    else console.log(line);
  }
}
