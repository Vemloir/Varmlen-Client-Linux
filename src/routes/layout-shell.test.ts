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

  it("rides with the pointer and slows down into the end of the list", () => {
    const action = read("../lib/swipe-nav.ts");
    expect(action).toMatch(/element\.style\.transform = /);
    // Past the first and the last tab the page still moves, but each pixel of
    // finger buys less of it, and it never reaches the limit.
    expect(action).toMatch(/wallOffset\(dx, WALL_LIMIT_PX\)/);
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

describe("shell: the tab pill floats over the pages, in three segments", () => {
  const layout = read("./+layout.svelte");
  const css = layout.slice(layout.indexOf("<style>"));

  it("floats over the pages instead of taking a row of its own", () => {
    expect(css).toMatch(/\.tabbar\s*\{[^}]*position:\s*absolute;/s);
    expect(css).toMatch(/\.tabbar\s*\{[^}]*z-index:\s*5;/s);
    expect(css).toMatch(/\.content\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/s);
    // The list has to keep room at the bottom or the last row hides for good.
    for (const page of ["./+page.svelte", "./split/+page.svelte", "./settings/+page.svelte"]) {
      expect(read(page)).toMatch(/var\(--nav-clearance\)/);
    }
  });

  it("partitions with transparent gaps, edge to edge by construction", () => {
    expect(css).toMatch(/\.tabbar\s*\{[^}]*gap:\s*2px;/s);
    // A drawn line (or a border) is either the page colour or a rounded sliver;
    // a gap is neither, and what scrolls behind it stays visible.
    expect(css).not.toMatch(/\.tab \+ \.tab/);
    // The plate is solid; only the partitions are open.
    expect(css).toMatch(/\.tab\s*\{[^}]*background:\s*var\(--nav-bg\);/s);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/color-mix/);
    // One tone below the card colour, in both themes.
    const app = read("../app.css");
    // The panel colour, darkened -- derived, so both themes get it.
    expect(app).toMatch(
      /--nav-bg:\s*color-mix\(in srgb, var\(--bg-elev\) 93%, #000000\);/,
    );
    // One stadium silhouette: only the outer corners round off.
    expect(css).toMatch(/\.tab:first-child\s*\{\s*border-radius:\s*999px 0 0 999px;/s);
    expect(css).toMatch(/\.tab:last-child\s*\{\s*border-radius:\s*0 999px 999px 0;/s);
  });

  it("is narrower than the window, so it reads as a control and not as an edge", () => {
    expect(css).toMatch(/\.tabbar\s*\{[^}]*width:\s*min\(300px, calc\(100% - 48px\)\);/s);
  });

  it("leaves the page layer out of the modal fight", () => {
    // will-change would give .page-shell its own stacking context, and every
    // modal inside a page would then paint under the tab pill.
    const shell = css.slice(css.indexOf(".page-shell"), css.indexOf("@keyframes page-from-right"));
    expect(shell).not.toMatch(/will-change\s*:/);
    expect(shell).toMatch(/position:\s*absolute;/);
  });

  it("fades the pages out at the bottom edge, without masking them", () => {
    const app = read("../app.css");
    expect(app).toMatch(/--fade-bottom:\s*56px;/);
    expect(css).toMatch(
      /\.edge-fade--bottom\s*\{[^}]*background:\s*linear-gradient\(to top, var\(--bg\), transparent\);/s,
    );
    // A mask on the scroll container is what trapped every modal under the pill.
    expect(app).not.toMatch(/fade-y/);
    for (const page of ["./+page.svelte", "./split/+page.svelte", "./settings/+page.svelte"]) {
      expect(read(page)).not.toMatch(/fade-y/);
    }
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