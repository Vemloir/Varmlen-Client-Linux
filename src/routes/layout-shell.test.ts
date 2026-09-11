import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * The shell around every page: how you get between tabs, and what the interface
 * lets you take out of it. These are layout-wide rules, so they are checked
 * against the layout rather than against a screenshot someone has to remember.
 */
describe("shell: tabs by swipe, with the new page arriving from the side", () => {
  const layout = read("./+layout.svelte");
  const shell = layout.slice(layout.indexOf("<div class=\"app\">"), layout.indexOf("<style>"));
  const css = layout.slice(layout.indexOf("<style>"));

  it("hands the content area to the swipe action", () => {
    expect(shell).toMatch(/<main\s+class="content"\s+use:swipeNav=\{\{/s);
    expect(shell).toMatch(/path: \(\) => page\.url\.pathname/);
    expect(shell).toMatch(/go: \(to\) => void goto\(to\)/);
  });

  it("rides with the pointer and gives the finger back at the ends", () => {
    const action = read("../lib/swipe-nav.ts");
    expect(action).toMatch(/element\.style\.transform = /);
    // Past the first and the last tab the page still moves, but at a fraction of
    // the finger and only so far: the app has an end, and it should say so.
    expect(action).toMatch(/WALL_RESIST = 0\.35/);
    expect(action).toMatch(/WALL_MAX_PX = 64/);
    // And the layout hands it the element to move.
    expect(layout).toMatch(/shell: \(\) => shellEl/);
    expect(layout).toMatch(/bind:this=\{shellEl\}/);
  });

  it("does not take a gesture that starts on a control or an open window", () => {
    const action = read("../lib/swipe-nav.ts");
    // A location row is a button, so a long press there cannot turn into a tab
    // change underneath the menu it just opened.
    expect(action).toMatch(/button, a, input, textarea, select/);
    // And a swipe over an open modal must not carry the draft away with it.
    expect(action).toMatch(/\.modal-backdrop, \.loc-menu/);
  });

  it("wraps the page in the one element that can move", () => {
    expect(shell).toMatch(
      /<div bind:this=\{shellEl\} class="page-shell" class:from-right=\{slide === "next"\} class:from-left=\{slide === "prev"\}>\s*\{@render children\?\.\(\)\}/s,
    );
    // Every page is absolutely positioned, so the wrapper has to be the box they
    // position against, or the swipe moves nothing.
    expect(css).toMatch(/\.page-shell\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/s);
  });

  it("animates with transform and opacity only", () => {
    const keyframes = css.slice(
      css.indexOf("@keyframes page-from-right"),
      css.indexOf(".page-shell.from-right"),
    );
    expect(keyframes).toMatch(/transform:\s*translateX\(-?\d+px\)/);
    expect(keyframes).toMatch(/opacity:/);
    expect(keyframes).not.toMatch(/margin|left:|width:/);
    expect(css).toMatch(/\.page-shell\.from-right\s*\{\s*animation:/);
    expect(css).toMatch(/\.page-shell\.from-left\s*\{\s*animation:/);
  });
});

describe("shell: the tab bar is a pill with two-pixel partitions", () => {
  const layout = read("./+layout.svelte");
  const css = layout.slice(layout.indexOf("<style>"));

  it("floats as a pill instead of welding a panel to the bottom edge", () => {
    expect(css).toMatch(/\.tabbar\s*\{[^}]*border-radius:\s*999px;/s);
    expect(css).not.toMatch(/\.tabbar\s*\{[^}]*border-top:/s);
  });

  it("divides the tabs with 2px of the page showing through", () => {
    expect(css).toMatch(/\.tab \+ \.tab\s*\{\s*border-left:\s*2px solid var\(--bg\);/s);
  });

  it("is narrower than the window, so it reads as a control and not as an edge", () => {
    expect(css).toMatch(/\.tabbar\s*\{[^}]*width:\s*min\(300px, calc\(100% - 48px\)\);/s);
    expect(css).toMatch(/\.tabbar\s*\{[^}]*align-self:\s*center;/s);
  });
});

describe("shell: nothing in the interface is selectable", () => {
  const css = read("../app.css");

  it("turns selection off on everything", () => {
    expect(css).toMatch(
      /\*\s*\{[^}]*user-select:\s*none;[^}]*-webkit-user-select:\s*none;/s,
    );
  });

  it("leaves the user's own text selectable", () => {
    expect(css).toMatch(
      /input,\s*textarea,\s*select,\s*\[contenteditable\],\s*\.selectable\s*\{[^}]*user-select:\s*text;/s,
    );
  });
});

describe("shell: each tab keeps the position the reader stopped at", () => {
  for (const page of ["./+page.svelte", "./split/+page.svelte", "./settings/+page.svelte"]) {
    it(`${page} restores its own offset`, () => {
      const source = read(page);
      expect(source).toMatch(/use:persistScroll=\{page\.url\.pathname\}/);
      expect(source).toMatch(/import \{ persistScroll \} from "\$lib\/scroll-memory"/);
    });
  }
});