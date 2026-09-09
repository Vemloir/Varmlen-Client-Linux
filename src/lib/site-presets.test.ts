import { describe, expect, it } from "vitest";
import {
  SITE_PRESET_GROUPS,
  isSitePattern,
  migrateSitePatterns,
  normalizeSitePattern,
  siteKindLabelKey,
  siteRuleKind,
  suggestSiteGroups,
} from "./site-presets";

describe("normalizeSitePattern", () => {
  it("writes one meaning as one spelling", () => {
    expect(normalizeSitePattern("example.com")).toBe("example.com");
    // The legacy asterisk spelling means the same thing, so it is written away.
    expect(normalizeSitePattern("*.example.com")).toBe("example.com");
    // A dotted name that is a whole domain is a host, not a zone.
    expect(normalizeSitePattern(".google.com")).toBe("google.com");
    // Only a single-label zone keeps its leading dot.
    expect(normalizeSitePattern(".ru")).toBe(".ru");
    expect(normalizeSitePattern("ru")).toBe(".ru");
    expect(normalizeSitePattern("=google.com")).toBe("=google.com");
    expect(normalizeSitePattern("=*.google.com")).toBe("=google.com");
  });

  it("strips what a pasted URL carries around the host", () => {
    expect(normalizeSitePattern("https://example.com/vpn")).toBe("example.com");
    expect(normalizeSitePattern("http://www.example.com:8080/a?b=c#d")).toBe("www.example.com:8080");
    expect(normalizeSitePattern("  Example.COM.  ")).toBe("example.com");
    expect(normalizeSitePattern("user@example.com")).toBe("example.com");
  });

  it("returns an empty string for nothing", () => {
    expect(normalizeSitePattern("   ")).toBe("");
    expect(normalizeSitePattern(".")).toBe("");
  });
});

describe("isSitePattern", () => {
  it("accepts hosts, zones and explicit exact hosts", () => {
    for (const value of [
      "example.com",
      "*.example.com",
      ".ru",
      "ru",
      "=example.com",
      "sub.example.co.uk",
    ]) {
      expect(isSitePattern(value), value).toBe(true);
    }
  });

  it("rejects anything the router could not match", () => {
    for (const value of [
      "",
      "   ",
      "example",
      "=example",
      "example.c",
      "*.",
      "exa mple.com",
      "-bad.com",
      "a..b.com",
      ".",
    ]) {
      expect(isSitePattern(value), value).toBe(false);
    }
  });

  it("refuses a port instead of silently dropping it", () => {
    expect(isSitePattern("example.com:8080")).toBe(false);
  });
});

describe("siteRuleKind", () => {
  it("names the three meanings", () => {
    expect(siteRuleKind("google.com")).toBe("suffix");
    expect(siteRuleKind(".ru")).toBe("zone");
    expect(siteRuleKind("=google.com")).toBe("exact");
  });

  it("has a wording key for every meaning", () => {
    const keys = (["suffix", "zone", "exact"] as const).map((kind) => siteKindLabelKey(kind));
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key.startsWith("split.")).toBe(true);
  });
});

describe("suggestSiteGroups", () => {
  it("offers every preset when nothing is listed", () => {
    const groups = suggestSiteGroups([]);
    expect(groups.map((g) => g.id)).toEqual(SITE_PRESET_GROUPS.map((g) => g.id));
    expect(groups[0].patterns.length).toBeGreaterThan(0);
  });

  it("drops presets that are listed, whatever spelling they were listed with", () => {
    // Listed as the legacy "*.ru", suggested as ".ru" -- still the same entry.
    const groups = suggestSiteGroups(["*.RU", " https://google.com "]);
    expect(groups[0].patterns).not.toContain(".ru");
    expect(groups[0].patterns).toContain(".by");
    const services = groups.find((g) => g.id === "services");
    expect(services?.patterns).not.toContain("google.com");
    expect(services?.patterns).toContain("github.com");
  });

  it("never emits a group that has nothing left to offer", () => {
    const all = SITE_PRESET_GROUPS.flatMap((g) => g.patterns);
    expect(suggestSiteGroups(all)).toEqual([]);
  });
});

describe("SITE_PRESET_GROUPS", () => {
  it("only contains patterns the router can read", () => {
    for (const group of SITE_PRESET_GROUPS) {
      for (const pattern of group.patterns) {
        expect(isSitePattern(pattern), pattern).toBe(true);
      }
    }
  });

  it("contains no asterisk, and spells zones with a leading dot", () => {
    // The whole point of the notation: nothing in front of the name to decode.
    for (const group of SITE_PRESET_GROUPS) {
      for (const pattern of group.patterns) {
        expect(pattern.includes("*"), pattern).toBe(false);
        if (group.id === "region") expect(pattern.startsWith("."), pattern).toBe(true);
        else expect(siteRuleKind(pattern), pattern).toBe("suffix");
      }
    }
  });

  it("keeps groups identifiable and labelled", () => {
    const ids = SITE_PRESET_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of SITE_PRESET_GROUPS) {
      expect(group.labelKey.startsWith("split."), group.id).toBe(true);
    }
  });
});

describe("migrateSitePatterns", () => {
  it("rewrites the old spelling without changing what it means", () => {
    const { sites, changed } = migrateSitePatterns([
      { id: "a", pattern: "*.example.com" },
      { id: "b", pattern: ".ru" },
      { id: "c", pattern: "=exact.test" },
    ]);
    expect(sites.map((s) => s.pattern)).toEqual(["example.com", ".ru", "=exact.test"]);
    expect(changed).toBe(true);
  });

  it("reports no change when everything is already written the current way", () => {
    const { sites, changed } = migrateSitePatterns([{ id: "a", pattern: "example.com" }]);
    expect(sites[0].pattern).toBe("example.com");
    expect(changed).toBe(false);
  });

  it("leaves a pattern it cannot understand alone", () => {
    const { sites } = migrateSitePatterns([{ id: "a", pattern: "   " }]);
    expect(sites[0].pattern).toBe("   ");
  });
});