/**
 * The silhouette of the fade at the bottom edge of the window.
 *
 * The boundary has six points, and they belong to the tab pill, not to the window:
 * the bottom-left corner of the window, the pill's leftmost point at its vertical
 * centre, the pill's leftmost point at its top, the pill's rightmost point at its
 * top, the pill's rightmost point at its vertical centre, the bottom-right corner of
 * the window. The fade therefore hugs the pill the way water would, and past its
 * shoulders the list only loses its very bottom.
 *
 * Geometry is measured from the real elements, so resizing the pill or the window
 * moves the curve by itself.
 */

/** How far above the pill the whole outline sits.
 *
 *  Hugging the pill exactly would put the plateau at the pill's top edge, which is
 *  below where a list ends: the fade would cover the pill's own plate and nothing
 *  else, and content would still be cut on a hard line above it. The outline keeps
 *  its shape and is lifted, so the list dims as it approaches the pill instead of
 *  after passing it. */
export const FADE_PAD_PX = 48;

export interface FadeGeometry {
  /** The content area the fade is drawn over. */
  width: number;
  height: number;
  /** The pill's box, in the same coordinate space. */
  pillLeft: number;
  pillRight: number;
  pillTop: number;
  pillMid: number;
  /** Defaults to {@link FADE_PAD_PX}. */
  pad?: number;
}

const n = (value: number): string => (Math.round(value * 10) / 10).toString();

/** An SVG path outlining the fade, closed along the bottom edge. */
export function fadePath(g: FadeGeometry): string {
  const w = g.width;
  const h = g.height;
  const pad = g.pad ?? FADE_PAD_PX;
  const plateau = Math.max(0, g.pillTop - pad);
  const shoulder = Math.max(0, g.pillMid - pad);
  return [
    `M 0 ${n(h)}`,
    `Q 0 ${n(shoulder)} ${n(g.pillLeft)} ${n(shoulder)}`,
    `L ${n(g.pillLeft)} ${n(plateau)}`,
    `L ${n(g.pillRight)} ${n(plateau)}`,
    `L ${n(g.pillRight)} ${n(shoulder)}`,
    `Q ${n(w)} ${n(shoulder)} ${n(w)} ${n(h)}`,
    "Z",
  ].join(" ");
}

/** Where the fade is opaque (the bottom edge) and where it is gone (the plateau). */
export function fadeGradient(g: FadeGeometry): { from: number; to: number } {
  return { from: g.height, to: Math.max(0, g.pillTop - (g.pad ?? FADE_PAD_PX)) };
}