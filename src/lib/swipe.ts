/**
 * The gesture behind swiping between tabs, and the arithmetic of where a swipe
 * lands. Pure so the thresholds are a contract instead of a feeling: the same
 * numbers decide whether a horizontal drag is a tab change or the start of a
 * scroll, and that is exactly the kind of rule that feels obvious while typing
 * and feels awful on a phone.
 */

export type SwipeDirection = "next" | "prev";

/** Below this the drag is a mis-aimed tap, not a swipe. */
export const SWIPE_MIN_X = 72;
/** The horizontal travel must beat the vertical by this much, or the user was
 *  scrolling and we would steal the gesture from the list. */
export const SWIPE_AXIS_RATIO = 2;
/** A drag held longer than this was a hold, not a flick: a long press that
 *  drifted sideways must not change the page under the menu it just opened. */
export const SWIPE_MAX_MS = 700;

export function swipeDirection(
  dx: number,
  dy: number,
  ms: number,
): SwipeDirection | null {
  if (Math.abs(dx) < SWIPE_MIN_X) return null;
  if (Math.abs(dx) < SWIPE_AXIS_RATIO * Math.abs(dy)) return null;
  if (ms > SWIPE_MAX_MS) return null;
  return dx < 0 ? "next" : "prev";
}

/**
 * The tab a swipe opens. The ends are walls, not a carousel: pulling past the
 * first tab and arriving at the last one reads as a bug, and on a three-tab bar
 * there is nothing to loop for.
 */
export function neighbourPath(
  current: string,
  direction: SwipeDirection,
  order: readonly string[],
): string | null {
  const at = order.indexOf(current);
  if (at === -1) return null;
  const target = direction === "next" ? at + 1 : at - 1;
  if (target < 0 || target >= order.length) return null;
  return order[target];
}

/**
 * Which way a route change should slide. Positive means the new page comes from
 * the right, which is where it is when you swipe left. Returns null when either
 * route is unknown (a modal, a deep link) -- no direction, no animation.
 */
export function slideDirection(
  from: string,
  to: string,
  order: readonly string[],
): SwipeDirection | null {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1 || a === b) return null;
  return b > a ? "next" : "prev";
}