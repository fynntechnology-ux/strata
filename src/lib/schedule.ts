/**
 * Cooperative yielding for long synchronous work.
 *
 * World generation and initial meshing each take a few hundred milliseconds of
 * straight-line CPU. Running them in one go freezes the tab; splitting them up
 * needs a way to hand control back to the browser between slices.
 *
 * The obvious choice — `requestAnimationFrame` — is wrong here. Browsers stop
 * firing it entirely in hidden tabs, so a player who loads the page and
 * switches away comes back to a loading bar frozen at 36% forever. `setTimeout`
 * survives that but gets clamped to ~1s per call in background tabs, which
 * turns a 300ms job into a five-minute one.
 *
 * `MessageChannel` is neither throttled nor clamped, and its callbacks are
 * macrotasks, so the browser still gets to paint between slices. Where
 * `scheduler.yield()` exists it is better still, because it resumes ahead of
 * newly-queued work instead of behind it.
 */

interface SchedulerApi {
  yield?: () => Promise<void>;
}

const nativeScheduler = (globalThis as { scheduler?: SchedulerApi }).scheduler;

const channel = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
const waiting: Array<() => void> = [];

if (channel) {
  channel.port1.onmessage = () => {
    waiting.shift()?.();
  };
}

/** Hands control back to the browser, then resumes. */
export function yieldToBrowser(): Promise<void> {
  if (nativeScheduler?.yield) return nativeScheduler.yield();

  if (channel) {
    return new Promise<void>((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(null);
    });
  }

  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Tracks a work budget across a loop.
 *
 * ```ts
 * const slice = new TimeSlice(12);
 * for (const item of items) {
 *   doWork(item);
 *   if (slice.expired()) await slice.yield();
 * }
 * ```
 */
export class TimeSlice {
  #start: number;

  constructor(private readonly budgetMs = 12) {
    this.#start = performance.now();
  }

  expired(): boolean {
    return performance.now() - this.#start >= this.budgetMs;
  }

  async yield(): Promise<void> {
    await yieldToBrowser();
    this.#start = performance.now();
  }

  /** Yield only if the budget is spent. Returns true if it yielded. */
  async maybeYield(): Promise<boolean> {
    if (!this.expired()) return false;
    await this.yield();
    return true;
  }
}
