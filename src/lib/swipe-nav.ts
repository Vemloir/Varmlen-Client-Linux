import { NAV } from "$lib/nav";
import {
  dragOffset,
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

/* Anything that takes text, and any window that is already open: a swipe over a
   half-typed form would change the tab and take the draft with it. */
const REFUSED =
  'input, textarea, select, [contenteditable], [data-no-swipe], .modal-backdrop, .loc-menu';

/* A control owns the gesture only until the finger says otherwise. The location
   list is a wall of buttons, so refusing a gesture that starts on one makes the
   first tab unsweipeable -- the page is nothing but rows. What the row actually
   wants is a tap or a long press, and neither of those is sideways. */
const CONTROL = "button, a";

/** Sideways travel before we commit to "this is a swipe" and start dragging. */
const DRAG_START_PX = 10;
/** How far the page will ever slide at the end of the list, approached but not
 *  reached: see wallOffset(). */
const WALL_LIMIT_PX = 96;
/** The way back when the drag did not reach the threshold. */
const SETTLE = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";
/** For the first moments of a drag the page follows the finger with a short lag
 *  instead of snapping to it: a gesture that starts with a jump of ten pixels
 *  reads as the interface deciding, not as the page being picked up. */
const START_MS = 120;
const START = `transform ${START_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
/** How long the released page takes to land on the neighbour it was dragged to. */
const COMMIT_MS = 180;
const COMMIT = `transform ${COMMIT_MS}ms cubic-bezier(0.2, 0, 0, 1)`;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface SwipeNavOptions {
  /** Read at the moment of the gesture, so the action never holds a stale path. */
  path: () => string;
  /** Resolves once the new page is in the DOM. */
  go: (path: string) => Promise<void> | void;
  /** The element that rides with the pointer: the track carrying the current page
   *  and the neighbour mounted beside it. */
  track?: () => HTMLElement | null;
  /** The neighbour to mount beside the page while the finger is down, and null
   *  when the gesture ends. Without it a swipe reveals a strip of background
   *  instead of the tab it is heading for. */
  preview?: (path: string | null) => void;
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
  let previewTo: string | null = null;
  let committing = false;
  let startedAt = 0;
  /** The control the finger landed on, if any, until the gesture takes it away. */
  let control: HTMLElement | null = null;

  const track = () => options.track?.() ?? null;

  /** Mount -- or keep mounted -- the neighbour the finger is heading for. */
  const showPreview = (to: string | null) => {
    if (to === previewTo) return;
    previewTo = to;
    options.preview?.(to);
  };

  const move = (dx: number, transition: "settle" | "start" | "none" = "none") => {
    const element = track();
    if (!element) return;
    element.style.transition =
      transition === "settle" ? SETTLE : transition === "start" ? START : "none";
    element.style.transform = dx === 0 ? "" : `translateX(${dx}px)`;
  };

  /**
   * The gesture belongs to the page now, so the control under the finger has to
   * be let go. It cannot be left to notice on its own: once this element holds
   * the pointer capture the row stops receiving pointermove, and its long press
   * would fire a menu in the middle of the swipe. So it is told out loud, and the
   * click the browser delivers afterwards never reaches it -- a swipe is not a way
   * of choosing a location.
   */
  const releaseControl = () => {
    const element = control;
    control = null;
    if (!element) return;
    element.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    // Scoped to the control that was let go: a tap somewhere else, a moment
    // later, is a tap and not a leftover of this gesture.
    const swallow = (event: MouseEvent) => {
      const node = event.target as Node | null;
      if (!node || !element.contains(node)) return;
      event.stopPropagation();
      event.preventDefault();
    };
    document.addEventListener("click", swallow, { capture: true });
    setTimeout(() => document.removeEventListener("click", swallow, true), 800);
  };

  const release = () => {
    if (pointerId === null) return;
    if (node.hasPointerCapture?.(pointerId)) node.releasePointerCapture(pointerId);
    pointerId = null;
    dragging = false;
  };

  /**
   * Land the released page on its neighbour, then swap the route underneath it.
   * The route changes only after the animation and the preview is dropped in the
   * same frame the track returns to rest: do it the other way round and the old
   * page flashes back at full width while the new one mounts.
   */
  const commit = async (to: string, direction: SwipeDirection) => {
    committing = true;
    const element = track();
    const width = element?.clientWidth ?? 0;
    control = null;
    if (element && width > 0) {
      element.style.transition = COMMIT;
      element.style.transform = `translateX(${direction === "next" ? -width : width}px)`;
      await wait(COMMIT_MS);
    }
    await options.go(to);
    showPreview(null);
    offset = 0;
    if (element) {
      element.style.transition = "none";
      element.style.transform = "";
    }
    committing = false;
  };

  const onDown = (event: PointerEvent) => {
    release();
    if (event.button !== 0 || committing) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(REFUSED)) return;
    control = target?.closest(CONTROL) ?? null;
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
      startedAt = performance.now();
      node.setPointerCapture?.(event.pointerId);
      releaseControl();
    }
    const direction: SwipeDirection = dx < 0 ? "next" : "prev";
    const neighbour = neighbourPath(options.path(), direction, order);
    // At the end of the strip there is no neighbour to show, only a wall.
    showPreview(neighbour);
    const span = track()?.clientWidth ?? 0;
    offset =
      neighbour === null ? wallOffset(dx, WALL_LIMIT_PX) : dragOffset(dx, span, WALL_LIMIT_PX);
    // One page of lag at the start, then the page tracks the finger exactly.
    move(offset, performance.now() - startedAt < START_MS ? "start" : "none");
  };

  const onUp = (event: PointerEvent) => {
    if (pointerId === null) return;
    const wasDragging = dragging;
    release();
    const dx = event.clientX - startX;
    const direction = swipeDirection(dx, event.clientY - startY, performance.now() - startAt);
    const target = direction ? neighbourPath(options.path(), direction, order) : null;
    if (target && wasDragging) {
      void commit(target, direction === "next" ? "next" : "prev");
      return;
    }
    showPreview(null);
    offset = 0;
    if (wasDragging) move(0, "settle");
  };

  const onCancel = () => {
    if (pointerId === null) return;
    release();
    control = null;
    showPreview(null);
    move(0, "settle");
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