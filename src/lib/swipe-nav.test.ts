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
    expect(source).toMatch(/showPreview\(neighbour\);/);
    expect(layout).toMatch(/preview: setPreview,/);
    expect(layout).toMatch(/<HomePage preview=\{preview\.path\} \/>/);
    expect(layout).toMatch(/<SplitPage preview=\{preview\.path\} \/>/);
    expect(layout).toMatch(/<SettingsPage preview=\{preview\.path\} \/>/);
  });

  it("shows a wall, not a neighbour, past the end of the strip", () => {
    expect(source).toMatch(
      /offset = neighbour === null \? wallOffset\(dx, WALL_LIMIT_PX\) : dx;/,
    );
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
    expect(source).toMatch(/if \(event\.button !== 0 \|\| committing\) return;/);
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
      expect(page).toMatch(/use:persistScroll=\{preview \|\| page\.url\.pathname\}/);
    }
  });

  it("does not let the neighbour do the live page's work", () => {
    // Settings reads autostart, the app version and notification permission, and
    // asks GitHub for core versions -- four round trips per gesture, twice.
    expect(settings.match(/if \(preview\) return;/g)?.length).toBeGreaterThanOrEqual(4);
  });
});