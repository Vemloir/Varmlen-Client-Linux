import { describe, expect, it } from "vitest";

import {
  SWIPE_AXIS_RATIO,
  SWIPE_MAX_MS,
  SWIPE_MIN_X,
  neighbourPath,
  slideDirection,
  swipeDirection,
  wallOffset,
  dragOffset,
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

  it("slows down into the wall instead of stopping at a number", () => {
    const LIMIT = 96;
    expect(wallOffset(0, LIMIT)).toBe(0);
    // At the wall the page follows the finger.
    expect(wallOffset(6, LIMIT) / 6).toBeGreaterThan(0.93);
    // Every extra pixel of finger buys less page than the one before it: the
    // increments between equal stretches of finger keep falling.
    const marks = [0, 6, 12, 24, 48, 96, 192, 4000];
    const rates = marks.slice(1).map((x, i) => ({ dx: x - marks[i], x, from: marks[i] }))
      .map(({ dx, x, from }) => (wallOffset(x, LIMIT) - wallOffset(from, LIMIT)) / dx);
    rates.forEach((rate, i) => {
      expect(rate).toBeGreaterThan(0);
      if (i > 0) expect(rate).toBeLessThan(rates[i - 1]);
    });
    // It approaches the limit and never arrives, so there is no stop to feel.
    expect(wallOffset(4000, LIMIT)).toBeLessThan(LIMIT);
    expect(wallOffset(4000, LIMIT)).toBeGreaterThan(LIMIT * 0.97);
    // Both ends behave the same way.
    expect(wallOffset(-96, LIMIT)).toBe(-wallOffset(96, LIMIT));
  });

  it("says which way a route change arrives, and stays silent about unknown routes", () => {
    expect(slideDirection("/", "/split", TABS)).toBe("next");
    expect(slideDirection("/settings", "/", TABS)).toBe("prev");
    expect(slideDirection("/split", "/split", TABS)).toBe(null);
    expect(slideDirection("/", "/unknown", TABS)).toBe(null);
  });
});

/**
 * A swipe delivers exactly one tab, so the page must not travel further than one
 * page no matter how far the finger goes: two pages of tab sliding past the
 * finger promises a jump the release never makes.
 */
describe("the drag stops at the tab it can deliver", () => {
  const SPAN = 440;
  const WALL = 96;

  it("follows the finger one to one within one page", () => {
    expect(dragOffset(0, SPAN, WALL)).toBe(0);
    expect(dragOffset(180, SPAN, WALL)).toBe(180);
    expect(dragOffset(-440, SPAN, WALL)).toBe(-440);
  });

  it("slows down past the page and never passes the limit", () => {
    expect(dragOffset(600, SPAN, WALL)).toBeGreaterThan(SPAN);
    expect(dragOffset(100_000, SPAN, WALL)).toBeLessThan(SPAN + WALL);
    expect(dragOffset(-600, SPAN, WALL)).toBeLessThan(-SPAN);
    expect(dragOffset(-100_000, SPAN, WALL)).toBeGreaterThan(-(SPAN + WALL));
  });

  it("gives up ground continuously, without a step at the boundary", () => {
    // The pixel just past the page has to buy less page than the pixel just
    // before it, and the rate keeps falling.
    const rate = (x: number) => dragOffset(x + 1, SPAN, WALL) - dragOffset(x, SPAN, WALL);
    expect(rate(SPAN - 1)).toBeCloseTo(1, 5);
    expect(rate(SPAN)).toBeLessThan(1);
    expect(rate(SPAN + 200)).toBeLessThan(rate(SPAN));
    expect(rate(SPAN + 2000)).toBeLessThan(rate(SPAN + 200));
  });

  it("does nothing at all when there is no page to measure", () => {
    expect(dragOffset(900, 0, WALL)).toBe(900);
  });
});
