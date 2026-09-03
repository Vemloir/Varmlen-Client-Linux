/** A refresh that failed is retried after this delay instead of on every
 *  reschedule: a machine that booted without a network must not spin on the
 *  fetch, and must not wait for the next provider boundary either, because the
 *  list it holds is the one that is already wrong. */
export const REFRESH_RETRY_BACKOFF_MS = 5 * 60_000;

export interface SubscriptionRefreshCandidate {
  id: string;
  /** ISO timestamp of the last fetch that produced locations. */
  lastSuccessIso: string;
  /** Provider-advertised interval. null / 0 disables automatic refresh. */
  intervalHours: number | null;
  /** Epoch ms of the last attempt made by this session, if any. */
  lastAttemptMs?: number | null;
  /** Whether that attempt produced locations. */
  lastAttemptOk?: boolean;
}

export interface SubscriptionRefreshBatch {
  at: number;
  ids: string[];
}

/** When a subscription becomes due, in epoch milliseconds.
 *
 *  An overdue subscription is due *now*. The client is a tray application that
 *  is closed between launches: scheduling the next boundary strictly after
 *  "now" means the boundary is almost never crossed while the window is open,
 *  the last successful fetch never advances, and the provider's rotating
 *  endpoints rot into dead locations. Catching up at start-up is what keeps a
 *  card connectable, and it is what the equivalent clients do.
 *
 *  A subscription that is not yet due keeps its own boundary, so a list of
 *  providers is still polled at the interval each of them asked for.
 */
export function nextRefreshAt(
  candidate: SubscriptionRefreshCandidate,
  nowMs: number,
): number {
  const last = Date.parse(candidate.lastSuccessIso);
  const intervalMs = (candidate.intervalHours ?? 0) * 3_600_000;
  if (
    !Number.isFinite(last) ||
    !(intervalMs > 0) ||
    !Number.isFinite(nowMs)
  ) {
    throw new Error("invalid subscription refresh schedule");
  }

  // Not yet due  -> the boundary itself. Overdue -> now (catch-up).
  let at = Math.max(last + intervalMs, nowMs);

  // A failed catch-up is retried on the backoff, not on the next reschedule.
  if (candidate.lastAttemptMs != null && candidate.lastAttemptOk === false) {
    at = Math.max(at, candidate.lastAttemptMs + REFRESH_RETRY_BACKOFF_MS);
  }

  // Never hand back a past instant: the caller arms a timer with it.
  return Math.max(at, nowMs);
}

/** Find the earliest moment any subscription becomes due, and every
 *  subscription due at exactly that moment. */
export function nextRefreshBatch(
  candidates: SubscriptionRefreshCandidate[],
  nowMs: number,
): SubscriptionRefreshBatch | null {
  let at = Number.POSITIVE_INFINITY;
  let ids: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.intervalHours || candidate.intervalHours <= 0) continue;
    let candidateAt: number;
    try {
      candidateAt = nextRefreshAt(candidate, nowMs);
    } catch {
      continue;
    }
    if (candidateAt < at) {
      at = candidateAt;
      ids = [candidate.id];
    } else if (candidateAt === at) {
      ids.push(candidate.id);
    }
  }
  return Number.isFinite(at) ? { at, ids } : null;
}
