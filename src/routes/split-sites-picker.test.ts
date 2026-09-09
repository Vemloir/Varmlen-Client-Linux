import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * The websites picker has two ways in -- type a pattern, or tick a suggestion --
 * and both of them have to end in a pattern the router can read. These assertions
 * keep the two tabs symmetric and keep validation on the path from the keyboard to
 * the store: a stored pattern that matches nothing sits in the list looking like a
 * rule while doing nothing.
 */
describe("split websites picker", () => {
  const split = read("./split/+page.svelte");
  const i18n = read("../lib/i18n.svelte.ts");

  it("offers adding on both tabs through the same full-width plate", () => {
    expect(split).toMatch(
      /<button class="btn panel-add" onclick=\{openAddApp\}>\{t\("split\.addApp"\)\}<\/button>/,
    );
    expect(split).toMatch(
      /<button class="btn panel-add" onclick=\{openAddSite\}>\{t\("split\.addSites"\)\}<\/button>/,
    );
    const css = split;
    expect(css).toMatch(/\.panel-add\s*\{[^}]*width:\s*100%;[^}]*border:\s*none;/s);
  });

  it("keeps the type-a-pattern form inside the modal, not on the tab", () => {
    const modal = split.slice(split.indexOf('{#if showAddSite}'));
    expect(modal).toMatch(/<form class="site-add" onsubmit=\{\(e\) => \{ e\.preventDefault\(\); commitTypedSite\(\); \}\}/);
    // The tab itself ends at the button: no second input competing with the picker.
    const tab = split.slice(split.indexOf('{:else}'), split.indexOf("{#if showAddSite}"));
    expect(tab).not.toMatch(/<form/);
  });

  it("validates and normalises what was typed before it reaches the store", () => {
    const commit = split.slice(split.indexOf("function commitTypedSite"), split.indexOf("function confirmAddSites"));
    expect(commit).toMatch(/normalizeSitePattern\(siteDraft\)/);
    expect(commit).toMatch(/if \(!isSitePattern\(pattern\)\)/);
    expect(commit).toMatch(/split\.addSite\(pattern\)/);
    // Nothing stores the raw field value.
    expect(split).not.toMatch(/split\.addSite\(siteDraft\)/);
  });

  it("filters suggestions against what is already listed", () => {
    expect(split).toMatch(
      /suggestSiteGroups\(split\.sites\.map\(\(s\) => s\.pattern\)\)/,
    );
    expect(split).toMatch(/\{#each sitePresets as group \(group\.id\)\}/);
    expect(split).toMatch(/\{#each group\.patterns as pattern \(pattern\)\}/);
  });

  it("asks for an exact host instead of guessing one", () => {
    const commit = split.slice(
      split.indexOf("function commitTypedSite"),
      split.indexOf("function confirmAddSites"),
    );
    // The plain form is the suffix rule; "=host" is only written when it was asked
    // for, and a zone cannot be narrowed to one host at all.
    expect(commit).toMatch(/if \(siteExactOnly && kind === "zone"\)/);
    expect(commit).toMatch(/if \(siteExactOnly && kind === "suffix"\) pattern = `=\$\{pattern\}`;/);
  });

  it("says in words what each listed entry means", () => {
    expect(split).toMatch(/\{t\(siteKindLabelKey\(siteRuleKind\(s\.pattern\)\)\)\}/);
  });

  it("rewrites the old spelling of a pattern on load", () => {
    const store = read("../lib/split.svelte.ts");
    expect(store).toMatch(/migrateSitePatterns\(loaded\.sites\.general\)\.sites/);
    expect(store).toMatch(/migrateSitePatterns\(loaded\.sites\.selective\)\.sites/);
  });

  it("keeps the asterisk out of the wording the user reads", () => {
    for (const key of ['"split.sitePlaceholder"', '"split.noSitesHint"', '"split.siteInvalid"']) {
      const line = i18n.split("\n").find((l) => l.trim().startsWith(key));
      expect(line, key).toBeDefined();
      expect(line?.includes("*"), key).toBe(false);
    }
  });

  it("names every new string in both languages", () => {
    for (const key of [
      '"split.addSites"',
      '"split.presetRegion"',
      '"split.presetServices"',
      '"split.siteInvalid"',
      '"split.noSitePresets"',
      '"split.siteExactOnly"',
      '"split.siteExactOnlyHint"',
      '"split.siteExactNeedsHost"',
      '"split.siteKindSuffix"',
      '"split.siteKindZone"',
      '"split.siteKindExact"',
      '"split.siteNotationHint"',
    ]) {
      const hits = i18n.split(key).length - 1;
      expect(hits, key).toBe(2);
    }
  });
});