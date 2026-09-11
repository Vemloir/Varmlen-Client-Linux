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
 * How far the page actually moves when the finger pulls past the first or the
 * last tab.
 *
 * At the wall the page follows the finger one to one, and every extra pixel of
 * finger buys proportionally less page: the pull slows down on its own and
 * approaches `limit` without ever reaching it. A fixed fraction with a hard cap
 * -- what this replaces -- stops dead at a number, which feels like hitting a bug
 * rather than the end of the app. The distance is in pixels of finger travel,
 * because that is the only thing the gesture knows.
 */
export function wallOffset(raw: number, limit: number): number {
  const distance = Math.abs(raw);
  const eased = (limit * distance) / (limit + distance);
  return raw < 0 ? -eased : eased;
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

/**
 * How far the page may move during one gesture: one page, and then the same
 * hyperbolic wall as at the end of the strip.
 *
 * Without the cap a long drag pulls two pages of tab past the finger, which
 * promises a jump the release never delivers -- a swipe always moves exactly one
 * tab. Past one page width every extra pixel of finger buys proportionally less
 * page, so the limit is leaned against rather than hit.
 */
export function dragOffset(raw: number, span: number, wallLimit: number): number {
  if (span <= 0) return raw;
  const sign = raw < 0 ? -1 : 1;
  const magnitude = Math.abs(raw);
  if (magnitude <= span) return raw;
  return sign * (span + wallOffset(magnitude - span, wallLimit));
}
