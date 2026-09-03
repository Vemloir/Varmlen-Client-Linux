import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  nextRefreshAt,
  nextRefreshBatch,
  REFRESH_RETRY_BACKOFF_MS,
} from "./subscription-refresh";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const at = (iso: string) => Date.parse(iso);

describe("subscription refresh scheduling", () => {
  it("keeps a subscription that is not yet due on its own boundary", () => {
    expect(nextRefreshAt({ ...every("1h"), lastSuccessIso: "2026-07-28T10:00:00Z" }, at("2026-07-28T10:20:00Z"))).toBe(
      at("2026-07-28T11:00:00Z"),
    );
  });

  it("brings a subscription whose interval passed due now", () => {
    expect(nextRefreshAt({ ...every("1h"), lastSuccessIso: "2026-07-28T10:00:00Z" }, at("2026-07-28T12:20:00Z"))).toBe(
      at("2026-07-28T12:20:00Z"),
    );
  });

  // The bug this replaces: a subscription last fetched two weeks ago was pushed
  // to the next boundary *after* the moment the app happened to be open, so the
  // boundary was never reached, the fetch never ran, and the card kept the
  // provider's retired endpoints. Providers rotate endpoints; that list dies.
  it("catches up a subscription left stale while the client was closed", () => {
    const now = at("2026-09-04T00:21:00Z");
    const twoWeeksAgo = new Date(now - 13 * 24 * 3_600_000).toISOString();
    expect(nextRefreshAt({ ...every("4h"), lastSuccessIso: twoWeeksAgo }, now)).toBe(now);
  });

  it("retries a failed attempt on the backoff instead of on every reschedule", () => {
    const now = at("2026-09-04T00:21:00Z");
    const due = nextRefreshAt(
      {
        ...every("4h"),
        lastSuccessIso: "2026-08-22T22:57:00Z",
        lastAttemptMs: now,
        lastAttemptOk: false,
      },
      now,
    );
    expect(due).toBe(now + REFRESH_RETRY_BACKOFF_MS);
  });

  it("lets a succeeded attempt fall back to the provider interval", () => {
    const now = at("2026-09-04T00:21:00Z");
    expect(
      nextRefreshAt(
        {
          ...every("4h"),
          lastSuccessIso: new Date(now - 60_000).toISOString(),
          lastAttemptMs: now - 60_000,
          lastAttemptOk: true,
        },
        now,
      ),
    ).toBe(now - 60_000 + 4 * 3_600_000);
  });

  it("never schedules in the past", () => {
    const now = at("2026-09-04T00:21:00Z");
    const due = nextRefreshAt(
      { ...every("4h"), lastSuccessIso: "2026-08-22T22:57:00Z", lastAttemptMs: now - 10 * 60_000, lastAttemptOk: false },
      now,
    );
    expect(due).toBeGreaterThanOrEqual(now);
  });

  it("rejects unusable schedules", () => {
    expect(() => nextRefreshAt({ ...every("1h"), lastSuccessIso: "not-a-date" }, Date.now())).toThrow(
      "invalid subscription refresh schedule",
    );
    expect(() => nextRefreshAt({ ...every("0h"), lastSuccessIso: "2026-07-28T10:00:00Z" }, Date.now())).toThrow(
      "invalid subscription refresh schedule",
    );
  });

  it("groups subscriptions that share the earliest future boundary", () => {
    const now = at("2026-07-28T10:20:00Z");
    expect(
      nextRefreshBatch(
        [
          { id: "hourly-a", lastSuccessIso: "2026-07-28T10:00:00Z", intervalHours: 1 },
          { id: "later", lastSuccessIso: "2026-07-28T10:00:00Z", intervalHours: 2 },
          { id: "half-hourly", lastSuccessIso: "2026-07-28T10:30:00Z", intervalHours: 0.5 },
          { id: "manual", lastSuccessIso: "2026-07-28T09:00:00Z", intervalHours: null },
        ],
        now,
      ),
    ).toEqual({
      at: at("2026-07-28T11:00:00Z"),
      ids: ["hourly-a", "half-hourly"],
    });
  });

  it("returns every stale subscription in the first batch", () => {
    const now = at("2026-09-04T00:21:00Z");
    const old = new Date(now - 13 * 24 * 3_600_000).toISOString();
    expect(
      nextRefreshBatch(
        [
          { id: "proxen", lastSuccessIso: old, intervalHours: 4 },
          { id: "aegis", lastSuccessIso: old, intervalHours: 1 },
          { id: "fresh", lastSuccessIso: new Date(now - 60_000).toISOString(), intervalHours: 24 },
        ],
        now,
      ),
    ).toEqual({ at: now, ids: ["proxen", "aegis"] });
  });
});

function every(hours: string) {
  return { id: "sub", intervalHours: parseFloat(hours) };
}

describe("subscription refresh setting contract", () => {
  it("is persisted, enabled by default, and exposed in Settings", () => {
    const store = read("./settings.svelte.ts");
    const page = read("../routes/settings/+page.svelte");

    expect(store).toContain("subscriptionAutoUpdate: boolean");
    expect(store).toMatch(/subscriptionAutoUpdate:\s*true/);
    expect(store).toContain("setSubscriptionAutoUpdate");
    expect(page).toContain('t("settings.subscriptionAutoUpdate")');
    expect(page).toContain("settings.setSubscriptionAutoUpdate");
  });

  it("uses one cancellable timer that the setting can stop", () => {
    const store = read("./subs.svelte.ts");
    const layout = read("../routes/+layout.svelte");

    expect(store).toContain("nextRefreshBatch");
    expect(store).toContain("setTimeout");
    expect(store).toContain("stopAutoRefresh");
    expect(store).not.toContain("setInterval(check");
    expect(store).not.toContain(".finally(check)");
    expect(layout).toContain("settings.subscriptionAutoUpdate");
    expect(layout).toContain("subs.stopAutoRefresh()");
  });
});

describe("failed subscription updates are visible", () => {
  it("keeps the previous locations and records why the update failed", () => {
    const store = read("./subs.svelte.ts");

    // A response that parses to nothing is a failure, not an empty success.
    expect(store).toMatch(/servers\.length === 0[\s\S]{0,400}lastError: NO_LOCATIONS_ERROR/);
    // The transport error is kept, and reported to the automatic scheduler so it
    // can back off rather than fire again immediately.
    expect(store).toMatch(/refreshing: false, lastError: describeError/);
    expect(store).toMatch(/autoRefreshAttempts\.set/);
    // And it is shown to the user on the card and in the info sheet.
    const page = read("../routes/+page.svelte");
    expect(page).toContain('t("home.updateFailed"');
    expect(page).toContain('t("info.updateError")');
  });
});
