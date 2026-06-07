/**
 * In-memory event store — the canonical audit log of agent actions
 * ({@link ScenarioResult}s), keyed by `taskId`. No database; results live for
 * the process lifetime.
 *
 * ## Concurrency
 * JavaScript (Node/Bun) runs on a single-threaded event loop, so each method
 * here executes to completion without interruption — there are no data races
 * between concurrent requests the way there would be with OS threads. All
 * mutating operations are therefore synchronous and atomic by construction,
 * which is "thread-safe enough" for a hackathon (and most production single-
 * process Node services). The only thing we guard against is logical races —
 * e.g. two requests minting the same `taskId` — via a duplicate-key check.
 *
 * ## Singleton
 * Exactly one store exists per process. Use `EventStore.getInstance()` (or the
 * exported `eventStore` constant); the constructor is private so callers can't
 * accidentally create a second, divergent store.
 */

import {
  type EventQuery,
  type EventStore as IEventStore,
  type ScenarioResult,
} from "../types/scenario.ts";

export class EventStore implements IEventStore {
  /** The one instance for this process. */
  private static instance: EventStore | undefined;

  /** Insertion order preserved; the index gives O(1) lookup by `taskId`. */
  private readonly order: ScenarioResult[] = [];
  private readonly index = new Map<string, ScenarioResult>();

  /** Private: construct only via {@link EventStore.getInstance}. */
  private constructor() {}

  /** Lazily create and return the process-wide singleton. */
  static getInstance(): EventStore {
    return (EventStore.instance ??= new EventStore());
  }

  // --- Required API -------------------------------------------------------

  /**
   * Append a result. Returns the stored copy.
   * @throws if a result with the same `taskId` already exists.
   */
  addEvent(result: ScenarioResult): ScenarioResult {
    if (this.index.has(result.taskId)) {
      throw new Error(`EventStore: duplicate taskId "${result.taskId}"`);
    }
    this.order.push(result);
    this.index.set(result.taskId, result);
    return result;
  }

  /**
   * Return stored results, oldest first. With a {@link EventQuery} the result
   * set is narrowed (all fields AND-combined); without one, everything is
   * returned. The returned array is a copy — mutating it won't affect the store.
   */
  getEvents(query: EventQuery = {}): ScenarioResult[] {
    let out = this.order;
    if (query.agent) out = out.filter((r) => r.agent === query.agent);
    if (query.status) out = out.filter((r) => r.status === query.status);
    if (query.actionType) out = out.filter((r) => r.actionType === query.actionType);
    if (typeof query.since === "number") {
      out = out.filter((r) => r.timestamp > query.since!);
    }
    if (query.limit && query.limit > 0) out = out.slice(-query.limit);
    // Return a fresh array; if we never filtered, `out` is still `this.order`.
    return out === this.order ? [...out] : out;
  }

  /** Look up a single result by its task id, or `undefined`. */
  getEventByTaskId(taskId: string): ScenarioResult | undefined {
    return this.index.get(taskId);
  }

  /** Remove all results. */
  clearEvents(): void {
    this.order.length = 0;
    this.index.clear();
  }

  // --- Extras -------------------------------------------------------------

  /** Number of stored results. */
  size(): number {
    return this.order.length;
  }
}

/** Process-wide singleton — the instance the API layer should import. */
export const eventStore: EventStore = EventStore.getInstance();
