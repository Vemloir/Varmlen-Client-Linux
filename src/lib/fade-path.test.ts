import { describe, expect, it } from "vitest";

import { FADE_PAD_PX, fadeGradient, fadePath, type FadeGeometry } from "./fade-path";

/**
 * The fade at the bottom edge follows the tab pill, not the window. Six points:
 * the window's bottom-left corner, the pill's leftmost point at its vertical
 * centre, the same at its top, the pill's rightmost point at its top, the same at
 * its vertical centre, the window's bottom-right corner.
 */
const GEOMETRY: FadeGeometry = {
  width: 440,
  height: 720,
  pillLeft: 70,
  pillRight: 370,
  pillTop: 662,
  pillMid: 686,
};

describe("the fade outline", () => {
  it("passes through the six points, in order", () => {
    const plateau = GEOMETRY.pillTop - FADE_PAD_PX;
    const shoulder = GEOMETRY.pillMid - FADE_PAD_PX;
    const steps = fadePath(GEOMETRY)
      .replace(/\bQ\b/g, "P")
      .replace(/\s*Z$/, "")
      .split(/ (?=[PLM] )/);
    expect(steps).toEqual([
      "M 0 720", // the window's bottom-left corner
      `P 0 ${shoulder} 70 ${shoulder}`, // up to the pill's leftmost point, at its centre
      `L 70 ${plateau}`, // and up to its top
      `L 370 ${plateau}`, // across the top of the pill
      `L 370 ${shoulder}`, // down to the pill's rightmost point, at its centre
      `P 440 ${shoulder} 440 720`, // and away to the window's bottom-right corner
    ]);
  });

  it("follows the pill when the pill changes", () => {
    const wider = fadePath({ ...GEOMETRY, pillLeft: 20, pillRight: 420 });
    expect(wider).toContain("L 20 ");
    expect(wider).toContain("L 420 ");
    const taller = fadePath({ ...GEOMETRY, pillTop: 640, pillMid: 672 });
    expect(taller).toContain(`L 70 ${640 - FADE_PAD_PX}`);
    expect(taller).toContain(`L 370 ${672 - FADE_PAD_PX}`);
  });

  it("fades between the bottom edge and the plateau", () => {
    expect(fadeGradient(GEOMETRY)).toEqual({
      from: 720,
      to: GEOMETRY.pillTop - FADE_PAD_PX,
    });
  });
});
