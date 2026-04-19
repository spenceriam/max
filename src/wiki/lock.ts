// ---------------------------------------------------------------------------
// In-process serializer for wiki mutations.
//
// All wiki state (pages + index.md + log.md) is shared mutable state in flat
// files. To prevent lost updates and torn writes when remember/forget/wiki_update
// and the async episode-writer overlap, every mutation must run through
// withWikiWrite(). Reads do NOT need to acquire the lock — they are protected
// by atomic file replacement at the FS level.
// ---------------------------------------------------------------------------

let chain: Promise<unknown> = Promise.resolve();

/**
 * Run an async wiki mutation under the global write lock.
 * Calls are serialized FIFO. Errors propagate to the caller but do not
 * break the chain for subsequent writers.
 */
export function withWikiWrite<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = chain.then(() => fn(), () => fn());
  // Keep the chain alive even if `next` rejects so the next caller can run.
  chain = next.catch(() => undefined);
  return next;
}

/** For tests/diagnostics: wait for the current write queue to drain. */
export function drainWikiWrites(): Promise<void> {
  return chain.then(() => undefined, () => undefined);
}
