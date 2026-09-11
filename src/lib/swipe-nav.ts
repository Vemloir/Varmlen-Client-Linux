import { NAV } from "$lib/nav";
import {
  neighbourPath,
  swipeDirection,
  wallOffset,
  type SwipeDirection,
} from "$lib/swipe";

/**
 * The pointer side of tab swiping. The decision itself lives in `swipe.ts`; this
 * file decides which gestures are ours to take and what the page does while the
 * finger is still down.
 *
 * A gesture that begins on a control is not ours. A row in the location list is a
 * button, so a long press there -- or a tap that drifted sideways -- never turns
 * into a page change underneath the menu it just opened.
 */

const CONTROLS =
  'button, a, input, textarea, select, [contenteditable], [data-no-swipe]';

/* A window that is open is not a page to swipe away from: the gesture would
   change the tab and take the half-typed draft with it. */
const OVERLAYS = ".modal-backdrop, .loc-menu";

/** Sideways travel before we commit to "this is a swipe" and start dragging. */
const DRAG_START_PX = 10;
/** How far the page will ever slide at the end of the list, approached but not
 *  reached: see wallOffset(). */
const WALL_LIMIT_PX = 96;
/** The way back when the drag did not reach the threshold. */
const SETTLE = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";

export interface SwipeNavOptions {
  /** Read at the moment of the gesture, so the action never holds a stale path. */
  path: () => string;
  go: (path: string) => void;
  /** The element that rides with the pointer. */
  shell?: () => HTMLElement | null;
  order?: readonly string[];
}

export function swipeNav(node: HTMLElement, options: SwipeNavOptions) {
  const order = options.order ?? NAV.map((item) => item.path);
  let startX = 0;
  let startY = 0;
  let startAt = 0;
  let pointerId: number | null = null;
  let dragging = false;
  let offset = 0;

  const shell = () => options.shell?.() ?? null;

  const move = (dx: number, withTransition: boolean) => {
    const element = shell();
    if (!element) return;
    element.style.transition = withTransition ? SETTLE : "none";
    element.style.transform = dx === 0 ? "" : `translateX(${dx}px)`;
  };

  const release = () => {
    if (pointerId === null) return;
    if (node.hasPointerCapture?.(pointerId)) node.releasePointerCapture(pointerId);
    pointerId = null;
    dragging = false;
  };

  const onDown = (event: PointerEvent) => {
    release();
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(`${CONTROLS}, ${OVERLAYS}`)) return;
    startX = event.clientX;
    startY = event.clientY;
    startAt = performance.now();
    pointerId = event.pointerId;
    dragging = false;
  };

  const onMove = (event: PointerEvent) => {
    if (pointerId === null) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging) {
      // Not committed yet: a vertical drag belongs to the list underneath, and
      // stealing it would make the app unreadable by touch.
      if (Math.abs(dx) < DRAG_START_PX || Math.abs(dx) < 2 * Math.abs(dy)) return;
      dragging = true;
      node.setPointerCapture?.(event.pointerId);
    }
    const direction: SwipeDirection = dx < 0 ? "next" : "prev";
    const blocked = neighbourPath(options.path(), direction, order) === null;
    offset = blocked ? wallOffset(dx, WALL_LIMIT_PX) : dx;
    move(offset, false);
  };

  const onUp = (event: PointerEvent) => {
    if (pointerId === null) return;
    const wasDragging = dragging;
    release();
    const dx = event.clientX - startX;
    const direction = swipeDirection(dx, event.clientY - startY, performance.now() - startAt);
    const target = direction ? neighbourPath(options.path(), direction, order) : null;
    offset = 0;
    if (target) {
      // Drop the offset in the same frame as the navigation: the new page is
      // rendered at rest and arrives with its own slide, instead of starting
      // from wherever the finger left it.
      move(0, false);
      options.go(target);
      return;
    }
    if (wasDragging) move(0, true);
  };

  const onCancel = () => {
    if (pointerId === null) return;
    release();
    move(0, true);
  };

  // A drag over a picture would otherwise start the browser's own image drag and
  // swallow the gesture.
  const onDragStart = (event: Event) => event.preventDefault();

  node.addEventListener("pointerdown", onDown);
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", onUp);
  node.addEventListener("pointercancel", onCancel);
  node.addEventListener("lostpointercapture", onCancel);
  node.addEventListener("dragstart", onDragStart);

  return {
    destroy() {
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onCancel);
      node.removeEventListener("lostpointercapture", onCancel);
      node.removeEventListener("dragstart", onDragStart);
    },
  };
}