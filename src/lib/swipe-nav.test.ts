import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A swipe that reveals a strip of empty background promises a tab it never shows.
 * The neighbour is mounted for real while the finger is down -- the same page
 * component over the same stores -- and the route only changes once the page has
 * been dragged onto it.
 */
const source = readFileSync(new URL("./swipe-nav.ts", import.meta.url), "utf8");
const layout = readFileSync(new URL("../routes/+layout.svelte", import.meta.url), "utf8");
const home = readFileSync(new URL("../routes/+page.svelte", import.meta.url), "utf8");
const split = readFileSync(new URL("../routes/split/+page.svelte", import.meta.url), "utf8");
const settings = readFileSync(new URL("../routes/settings/+page.svelte", import.meta.url), "utf8");

describe("the neighbour under the finger", () => {
  it("drags the track that carries both pages, not the page alone", () => {
    expect(source).toMatch(/track\?: \(\) => HTMLElement \| null;/);
    expect(source).toMatch(/const track = \(\) => options\.track\?\.\(\) \?\? null;/);
    expect(layout).toMatch(/bind:this=\{trackEl\} class="page-track"/);
    expect(layout).toMatch(/track: \(\) => trackEl \?\? null,/);
  });

  it("mounts the neighbour the gesture is heading for", () => {
    expect(source).toMatch(/preview\?: \(path: string \| null\) => void;/);
    expect(source).toMatch(/const neighbour = neighbourPath\(options\.path\(\), direction, order\);/);
    expect(source).toMatch(/showPreview\(neighbour\);/);
    expect(layout).toMatch(/preview: setPreview,/);
    expect(layout).toMatch(/<HomePage preview=\{preview\.path\} \/>/);
    expect(layout).toMatch(/<SplitPage preview=\{preview\.path\} \/>/);
    expect(layout).toMatch(/<SettingsPage preview=\{preview\.path\} \/>/);
  });

  it("drags the same sheet everywhere, and switches where there is a tab", () => {
    // The end of the strip does not lack resistance -- it lacks the switch. One
    // physics for both means a drag in the middle cannot be pulled further than
    // the page is ever willing to travel.
    // 1:1 under the finger, wall only where the strip runs out.
    expect(source).toMatch(/const span = neighbour \? node\.getBoundingClientRect\(\)\.width : 0;/);
    expect(source).toMatch(/offset = pageTravel\(dx, span, WALL_LIMIT_PX\);/);
    expect(source).toMatch(/move\(offset, "none"\);/);
    expect(source).not.toMatch(/dragOffset/);
  });

  it("starts the drag at the finger instead of at the press", () => {
    // The slop had already been travelled when the gesture became a swipe; carrying
    // it into the page is the jump this removes.
    const commit = source.slice(source.indexOf("dragging = true;"));
    expect(commit.slice(0, 400)).toMatch(/startX = event\.clientX;/);
    expect(commit.slice(0, 400)).toMatch(/startY = event\.clientY;/);
    // And nothing animates underneath the finger.
    expect(source).not.toMatch(/START_MS/);
    expect(source).toMatch(/element\.style\.transition = transition === "settle" \? SETTLE : "none";/);
  });

  it("takes the gesture away from the control it started on", () => {
    // The location list is a wall of buttons: refusing those gestures makes the
    // first tab unsweipeable. The row is released instead -- its long press cannot
    // see the movement once the page holds the pointer capture, and the click that
    // follows a swipe must not choose a location.
    // Addressed to the control alone. A bubbling cancel reaches the content area,
    // reads as the platform taking the pointer, and our own handler drops the
    // gesture -- a swipe on a location row sprang back to rest.
    expect(source).toMatch(/new PointerEvent\("pointercancel", \{ bubbles: false \}\)/);
    expect(source).toMatch(/if \(!event\.isTrusted\) return;/);
    expect(source).toMatch(/document\.addEventListener\("click", swallow, \{ capture: true \}\);/);
    // Only the control that was let go loses its click -- a tap elsewhere a moment
    // later is a tap.
    expect(source).toMatch(/if \(!node \|\| !element\.contains\(node\)\) return;/);
    expect(source).toMatch(/setTimeout\(\(\) => document\.removeEventListener\("click", swallow, true\), 800\);/);
    expect(source).toMatch(/releaseControl\(\);/);
    expect(source).toMatch(/const CONTROL = "button, a";/);
  });

  it("changes the route only after the page has landed on the neighbour", () => {
    const commit = source.slice(source.indexOf("const commit = async"));
    const go = commit.indexOf("await options.go(to)");
    expect(go).toBeGreaterThan(-1);
    // The animation runs first, and the track is only returned to rest after the
    // new page is in the DOM -- otherwise the old page flashes back at full width.
    expect(commit.slice(0, go)).toMatch(/await wait\(COMMIT_MS\);/);
    expect(commit.slice(go)).toMatch(/showPreview\(null\);/);
    expect(commit.slice(commit.indexOf("showPreview(null)"))).toMatch(
      /element\.style\.transform = "";/,
    );
  });

  it("ignores a second gesture while the page is landing", () => {
    expect(source).toMatch(/if \(committing\) return;/);
  });

  it("follows one pointer, not every pointer in the room", () => {
    // Measured in the installed build: a mouse moving next to a finger in progress
    // rewrote the start point and the page jittered between two offsets.
    expect(source).toMatch(/if \(pointerId !== null\) return;/);
    expect(source.match(/event\.pointerId !== pointerId/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the neighbour out of reach and out of the accessibility tree", () => {
    expect(layout).toMatch(/class="page-shell preview"/);
    expect(layout).toMatch(/aria-hidden="true"/);
    expect(layout).toMatch(/\.preview\s*\{[^}]*pointer-events:\s*none;/s);
    expect(layout).toMatch(/\.preview--next\s*\{\s*left:\s*100%;/);
    expect(layout).toMatch(/\.preview--prev\s*\{\s*right:\s*100%;/);
    // `.page-shell` sets `inset: 0` with the same specificity, so the neighbour's
    // own placement has to come after it or it lands on top of the live page.
    expect(layout.indexOf(".preview--next")).toBeGreaterThan(layout.indexOf(".page-shell {"));
  });

  it("does not run the arrival animation twice on a dragged-in page", () => {
    expect(layout).toMatch(/draggedIn = to;/);
    expect(layout).toMatch(/if \(draggedIn === path\) \{\s*draggedIn = null;\s*slide = null;/);
  });

  it("keeps the neighbour's own reading position, not the current tab's", () => {
    for (const page of [home, split, settings]) {
      expect(page).toMatch(/use:persistScroll=\{preview \|\| navPath\(\)\}/);
    }
  });

  it("does not let the neighbour do the live page's work", () => {
    // Settings reads autostart, the app version and notification permission, and
    // asks GitHub for core versions -- four round trips per gesture, twice.
    expect(settings.match(/if \(preview\) return;/g)?.length).toBeGreaterThanOrEqual(4);
  });
});