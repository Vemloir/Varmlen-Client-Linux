import { describe, expect, it } from "vitest";
import {
  hiddenCount,
  isHiddenLocation,
  locationActions,
  orderLocations,
} from "./location-actions";

interface Row {
  id: string;
  key: string;
}

const row = (id: string, key = `vless:${id}:443:u`): Row => ({ id, key });
const keyOf = (r: Row) => r.key;

const order = (
  servers: Row[],
  over: Partial<Parameters<typeof orderLocations<Row>>[1]> = {},
) =>
  orderLocations(servers, {
    keyOf,
    hiddenKeys: [],
    pinnedAt: {},
    hideMode: "untilManualRefresh",
    revealHidden: false,
    pinOrder: "newestLast",
    ...over,
  });

describe("location menu", () => {
  it("offers hide, never delete, for a location from a subscription", () => {
    expect(
      locationActions({
        fromSubscription: true,
        hidden: false,
        pinned: false,
        hideMode: "untilManualRefresh",
      }),
    ).toEqual(["ping", "rename", "pin", "hide"]);
  });

  it("offers delete, never hide, for a manually added location", () => {
    // Nothing regenerates a manual location, so "hide" would only lose it.
    expect(
      locationActions({
        fromSubscription: false,
        hidden: false,
        pinned: true,
        hideMode: "always",
      }),
    ).toEqual(["ping", "rename", "unpin", "delete"]);
  });

  it("flips hide and pin against the current state", () => {
    expect(
      locationActions({
        fromSubscription: true,
        hidden: true,
        pinned: true,
        hideMode: "always",
      }),
    ).toEqual(["ping", "rename", "unpin", "unhide"]);
  });

  it("offers no hide at all when hiding is switched off", () => {
    expect(
      locationActions({
        fromSubscription: true,
        hidden: false,
        pinned: false,
        hideMode: "off",
      }),
    ).toEqual(["ping", "rename", "pin"]);
  });
});

describe("hidden locations", () => {
  it("keeps a hidden location out of the list and counts it", () => {
    const servers = [row("a"), row("b"), row("c")];
    const hiddenKeys = [servers[1].key];
    const out = order(servers, { hiddenKeys });
    expect(out.visible.map((s) => s.id)).toEqual(["a", "c"]);
    expect(out.hidden.map((s) => s.id)).toEqual(["b"]);
    expect(hiddenCount(servers, keyOf, hiddenKeys, "untilManualRefresh")).toBe(1);
  });

  it("shows everything again when hiding is switched off, but keeps the list", () => {
    const servers = [row("a"), row("b")];
    const hiddenKeys = [servers[1].key];
    expect(isHiddenLocation(servers[1].key, hiddenKeys, "off", false)).toBe(false);
    expect(order(servers, { hiddenKeys, hideMode: "off" }).visible).toHaveLength(2);
    expect(hiddenCount(servers, keyOf, hiddenKeys, "off")).toBe(0);
  });

  it("reveals hidden locations on request without un-hiding them", () => {
    const servers = [row("a"), row("b")];
    const hiddenKeys = [servers[1].key];
    const out = order(servers, { hiddenKeys, revealHidden: true });
    expect(out.visible.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out.hidden).toHaveLength(0);
    // Still counted, so the card keeps offering the way to hide them again.
    expect(hiddenCount(servers, keyOf, hiddenKeys, "always")).toBe(1);
  });
});

describe("pinned locations", () => {
  it("moves pinned locations into their own block, oldest first by default", () => {
    const servers = [row("a"), row("b"), row("c"), row("d")];
    const pinnedAt: Record<string, number> = {
      [servers[1].key]: 20,
      [servers[3].key]: 10,
    };
    expect(order(servers, { pinnedAt }).visible.map((s) => s.id)).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
  });

  it("reverses the pinned block when asked for newest first", () => {
    const servers = [row("a"), row("b"), row("c"), row("d")];
    const pinnedAt: Record<string, number> = {
      [servers[1].key]: 20,
      [servers[3].key]: 10,
    };
    expect(
      order(servers, { pinnedAt, pinOrder: "newestFirst" })
        .visible.map((s) => s.id),
    ).toEqual(["a", "c", "b", "d"]);
  });

  it("keeps a pinned location hidden while it is hidden", () => {
    const servers = [row("a"), row("b")];
    const out = order(servers, {
      pinnedAt: { [servers[1].key]: 5 },
      hiddenKeys: [servers[1].key],
    });
    expect(out.visible.map((s) => s.id)).toEqual(["a"]);
    expect(out.hidden.map((s) => s.id)).toEqual(["b"]);
  });
});
