import { describe, expect, it } from "vitest";
import {
  SITE_PRESET_GROUPS,
  isSitePattern,
  normalizeSitePattern,
  suggestSiteGroups,
} from "./site-presets";

describe("normalizeSitePattern", () => {
  it("keeps a plain host and a wildcard host", () => {
    expect(normalizeSitePattern("example.com")).toBe("example.com");
    expect(normalizeSitePattern("*.example.com")).toBe("*.example.com");
  });

  it("strips what a pasted URL carries around the host", () => {
    expect(normalizeSitePattern("https://example.com/vpn")).toBe("example.com");
    expect(normalizeSitePattern("http://www.example.com:8080/a?b=c#d")).toBe("www.example.com:8080");
    expect(normalizeSitePattern("  Example.COM.  ")).toBe("example.com");
    expect(normalizeSitePattern("user@example.com")).toBe("example.com");
  });

  it("returns an empty string for nothing", () => {
    expect(normalizeSitePattern("   ")).toBe("");
  });
});

describe("isSitePattern", () => {
  it("accepts hosts and wildcards", () => {
    for (const value of ["example.com", "*.example.com", "*.ru", "sub.example.co.uk"]) {
      expect(isSitePattern(value)).toBe(true);
    }
  });

  it("rejects anything the router could not match", () => {
    for (const value of ["", "   ", "example", "example.c", "*.", "exa mple.com", "-bad.com", "a..b.com"]) {
      expect(isSitePattern(value)).toBe(false);
    }
  });

  it("refuses a port instead of silently dropping it", () => {
    expect(isSitePattern("example.com:8080")).toBe(false);
  });
});

describe("suggestSiteGroups", () => {
  it("offers every preset when nothing is listed", () => {
    const groups = suggestSiteGroups([]);
    expect(groups.map((g) => g.id)).toEqual(SITE_PRESET_GROUPS.map((g) => g.id));
    expect(groups[0].patterns.length).toBeGreaterThan(0);
  });

  it("drops the presets that are already listed, whatever case they were typed in", () => {
    const groups = suggestSiteGroups(["*.RU", "  *.google.com "]);
    expect(groups[0].patterns).not.toContain("*.ru");
    expect(groups[0].patterns).toContain("*.by");
    const services = groups.find((g) => g.id === "services");
    expect(services?.patterns).not.toContain("*.google.com");
    expect(services?.patterns).toContain("*.github.com");
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

  it("suggests wildcards, never a single host", () => {
    // A bare host routes one apex host and leaves www on the tunnel.
    for (const group of SITE_PRESET_GROUPS) {
      for (const pattern of group.patterns) {
        expect(pattern.startsWith("*."), pattern).toBe(true);
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