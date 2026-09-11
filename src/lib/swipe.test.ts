import { describe, expect, it } from "vitest";

import {
  SWIPE_AXIS_RATIO,
  SWIPE_MAX_MS,
  SWIPE_MIN_X,
  neighbourPath,
  slideDirection,
  swipeDirection,
} from "./swipe";

const TABS = ["/", "/split", "/settings"] as const;

/**
 * A swipe has to win against two neighbours: a tap that drifted, and a scroll
 * that wobbled sideways. Both are more common than a deliberate flick, so the
 * rule is "clearly sideways, clearly short, clearly far".
 */
describe("swipe between tabs", () => {
  it("takes a clear horizontal flick in either direction", () => {
    expect(swipeDirection(-SWIPE_MIN_X, 0, 200)).toBe("next");
    expect(swipeDirection(SWIPE_MIN_X, 0, 200)).toBe("prev");
    expect(swipeDirection(-400, -20, 400)).toBe("next");
  });

  it("leaves a short drag alone", () => {
    expect(swipeDirection(-(SWIPE_MIN_X - 1), 0, 100)).toBe(null);
    expect(swipeDirection(0, 0, 100)).toBe(null);
  });

  it("leaves a scroll that wobbled sideways alone", () => {
    // Twice as much horizontal as vertical is the price; a flick this slanted is
    // the user reading a list, not changing tabs.
    expect(swipeDirection(SWIPE_MIN_X * SWIPE_AXIS_RATIO, SWIPE_MIN_X + 1, 200)).toBe(null);
    expect(swipeDirection(SWIPE_MIN_X, SWIPE_MIN_X, 200)).toBe(null);
    expect(swipeDirection(-200, -150, 200)).toBe(null);
  });

  it("leaves a long press that drifted alone", () => {
    // The location menu opens on a hold. A hold that slid sideways must not
    // change the page underneath the menu it just summoned.
    expect(swipeDirection(-300, 0, SWIPE_MAX_MS + 1)).toBe(null);
    expect(swipeDirection(-300, 0, SWIPE_MAX_MS)).toBe("next");
  });

  it("walks one tab either way and stops at the ends", () => {
    expect(neighbourPath("/", "next", TABS)).toBe("/split");
    expect(neighbourPath("/split", "prev", TABS)).toBe("/");
    expect(neighbourPath("/split", "next", TABS)).toBe("/settings");
    expect(neighbourPath("/", "prev", TABS)).toBe(null);
    expect(neighbourPath("/settings", "next", TABS)).toBe(null);
    expect(neighbourPath("/somewhere/else", "next", TABS)).toBe(null);
  });

  it("says which way a route change arrives, and stays silent about unknown routes", () => {
    expect(slideDirection("/", "/split", TABS)).toBe("next");
    expect(slideDirection("/settings", "/", TABS)).toBe("prev");
    expect(slideDirection("/split", "/split", TABS)).toBe(null);
    expect(slideDirection("/", "/unknown", TABS)).toBe(null);
  });
});