<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { NAV } from "$lib/nav";
  import { swipeNav } from "$lib/swipe-nav";
  import { slideDirection } from "$lib/swipe";
  import { t } from "$lib/i18n.svelte";
  import { core } from "$lib/core.svelte";
  import { conn } from "$lib/conn.svelte";
  import { subs } from "$lib/subs.svelte";
  import { split } from "$lib/split.svelte";
  import { settings } from "$lib/settings.svelte";
  import { readLegacyStorage, setTrayStatus, setCloseToTray, setStatusBar } from "$lib/api";
  import { listen } from "@tauri-apps/api/event";
  import { theme } from "$lib/theme.svelte";
  import { isAndroid } from "$lib/platform";

  /** One-shot migration on first launch in a new origin (e.g. release vs dev
   *  use different WebKit storage). Pulls everything from the previous
   *  origin's localStorage and reloads so the stores re-init from it. */
  async function migrateLegacyStorage() {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("varmlen.subs") !== null) return; // already seeded
    try {
      const data = await readLegacyStorage();
      const entries = Object.entries(data ?? {});
      console.log(`[migrate] legacy storage: ${entries.length} keys`);
      if (entries.length === 0) return;
      for (const [k, v] of entries) localStorage.setItem(k, v);
      window.location.reload();
    } catch (e) {
      console.error("[migrate] failed:", e);
    }
  }

  // The WebView here is a component, not a browser: a right-click must never
  // offer Back / Forward / Stop / Reload. Editable fields keep their own
  // Cut/Copy/Paste, which is the only menu a user ever wants from this gesture.
  $effect(() => {
    const onContext = (event: MouseEvent) => {
      const el = event.target as HTMLElement | null;
      if (!el) return;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", onContext, { capture: true });

    // Same for the keyboard: Backspace and Alt+arrows are browser history
    // gestures, and in a WebView they leave the app instead of doing nothing.
    // Inside a field Backspace still deletes.
    const onKeydown = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      const editable =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (event.key === "Backspace" && !editable) {
        event.preventDefault();
        return;
      }
      if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeydown, { capture: true });

    return () => {
      document.removeEventListener("contextmenu", onContext, { capture: true });
      document.removeEventListener("keydown", onKeydown, { capture: true });
    };
  });

  let { children } = $props();

  // Reading `page.url.pathname` through a $derived ensures the active-tab
  // class re-evaluates reliably on every navigation (intermittent stale state
  // otherwise).
  const currentPath = $derived(page.url.pathname);
  const TAB_PATHS = NAV.map((item) => item.path);

  // Which way a new page arrives. Recorded while the path changes and cleared
  // when the animation is over, so a re-render cannot restart it.
  let slide = $state<"next" | "prev" | null>(null);
  /** The element the finger drags. Read through a getter because the action is
   *  attached to the content area before this child exists. */
  let shellEl: HTMLDivElement | undefined = $state();
  let previousPath = "/";
  $effect(() => {
    const path = page.url.pathname;
    const direction = slideDirection(previousPath, path, TAB_PATHS);
    previousPath = path;
    if (!direction) {
      slide = null;
      return;
    }
    slide = direction;
    const timer = setTimeout(() => (slide = null), 200);
    return () => clearTimeout(timer);
  });

  function isActive(path: string): boolean {
    if (path === "/") return currentPath === "/";
    return currentPath.startsWith(path);
  }

  // First-launch chores: migrate prior-origin localStorage + install the core.
  // Network permissions are NOT requested here — they're prompted on the first
  // connect (when actually needed), so launch is non-intrusive.
  onMount(async () => {
    await migrateLegacyStorage();
    // xray is the sole core (native TUN + transport).
    await core.autoInit();
  });

  // Reflect the real VPN state on launch: if xray is still running (e.g. the
  // window was just recreated), show "connected" instead of a stale
  // "disconnected".
  onMount(() => void conn.refresh());

  // Re-sync when the app returns to the foreground — the VPN may have been
  // toggled from the Quick Settings tile / notification while we were away.
  onMount(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void conn.refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  });

  // A native (Rust) watcher emits a global `vpn-running` event the instant the
  // tunnel goes up or down — including a disconnect from the notification, the
  // tile, a system revoke, or a crashed core. Global events ride core:event
  // (granted) and aren't throttled like JS timers, so this is the instant path.
  onMount(() => {
    const un = listen<boolean>("vpn-running", (e) => conn.applyExternalState(e.payload));
    return () => void un.then((f) => f());
  });

  // Backstop only, in case an event is ever missed across process churn.
  onMount(() => {
    const id = setInterval(() => {
      if (conn.status === "connected") void conn.refresh();
    }, 2000);
    return () => clearInterval(id);
  });

  // Schedule only the next future provider boundary. Opening the application
  // never triggers a subscription request, and disabling the setting cancels
  // the pending timer immediately.
  $effect(() => {
    if (!settings.subscriptionAutoUpdate) {
      subs.stopAutoRefresh();
      return;
    }
    return subs.startAutoRefresh();
  });

  // Tray "Connect / Disconnect" menu item routes back here (the connect logic
  // — current server + split config — lives in the frontend).
  onMount(() => {
    const un = listen("tray://toggle", () => void conn.toggle());
    return () => void un.then((f) => f());
  });

  // Keep the tray tooltip in sync with the (localized) connection status.
  $effect(() => {
    void setTrayStatus(t(`status.${conn.status}`));
  });

  // Push the close-to-tray preference to the backend (on launch + on change),
  // since the window-close handler lives in Rust.
  $effect(() => {
    void setCloseToTray(settings.closeToTray);
  });

  // Live-reconnect when the config changes (location / split / mode / settings)
  // while connected. Reading these here registers them as effect dependencies.
  $effect(() => {
    void subs.selectedKey;
    void settings.vpnMode;
    void settings.killswitch;
    void settings.allowLan;
    void split.appsMode;
    void split.sitesMode;
    void split.apps;
    void split.sites;
    conn.onConfigChanged();
  });

  // Android: match the system-bar icon colour to the theme (light theme → dark
  // icons, so the clock / battery / wifi stay visible on the white background).
  $effect(() => {
    if (isAndroid) setStatusBar(theme.current === "light").catch(() => {});
  });
</script>

<div class="app">
  <main
    class="content"
    use:swipeNav={{
      path: () => page.url.pathname,
      go: (to) => void goto(to),
      shell: () => shellEl ?? null,
    }}
  >
    <div bind:this={shellEl} class="page-shell" class:from-right={slide === "next"} class:from-left={slide === "prev"}>
      {@render children?.()}
    </div>
    <!-- Over the pages, under the pill (5) and under every modal (100). The fade
         is a layer rather than a mask on the scroll container: a mask makes that
         container a stacking context, and every modal inside it then paints under
         the tab pill -- dimmed page, bright pill. -->
    <div class="edge-fade edge-fade--bottom" aria-hidden="true"></div>
  </main>

  <nav class="tabbar">
    {#each NAV as item}
      <a
        href={item.path}
        class="tab"
        class:active={isActive(item.path)}
        class:no-label={!settings.navLabels}
        aria-label={t(item.labelKey)}
        aria-current={isActive(item.path) ? "page" : undefined}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d={item.icon} fill="currentColor" />
        </svg>
        {#if settings.navLabels}<span>{t(item.labelKey)}</span>{/if}
      </a>
    {/each}
  </nav>
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
    background: var(--bg);
  }

  /* The pages run to the bottom edge of the window and the pill floats over
     them. A panel taking a row of its own in this flex column cut every list on
     a hard line above itself, and painted the pill over any open modal. */
  .content {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  /* Every page is absolutely positioned inside this, so it is the one thing that
     can move for a tab change without asking the pages to cooperate. */
  .edge-fade {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: none;
    z-index: 3;
  }
  .edge-fade--bottom {
    bottom: 0;
    height: var(--fade-bottom);
    background: linear-gradient(to top, var(--bg), transparent);
  }

  .page-shell {
    position: absolute;
    inset: 0;
    /* No will-change here on purpose. It would give this element its own layer
       and therefore its own stacking context, and every modal rendered inside a
       page would then sit under the tab pill -- dimmed page, bright pill. */
  }
  /* Transform and opacity only, and the arriving page rather than a crossfade:
     the outgoing page is already gone by the time the new one is rendered, and
     pretending otherwise would need both mounted at once. */
  @keyframes page-from-right {
    from { transform: translateX(28px); opacity: 0.35; }
    to { transform: none; opacity: 1; }
  }
  @keyframes page-from-left {
    from { transform: translateX(-28px); opacity: 0.35; }
    to { transform: none; opacity: 1; }
  }
  .page-shell.from-right { animation: page-from-right 180ms cubic-bezier(0.2, 0, 0, 1); }
  .page-shell.from-left { animation: page-from-left 180ms cubic-bezier(0.2, 0, 0, 1); }

  /* Without the label the icon sits alone, so it gets the height the label used to
     take and stays on the same centre line. */
  .tab.no-label {
    padding: 9px 4px;
  }

  .tabbar {
    position: absolute;
    left: 50%;
    bottom: max(var(--nav-inset), env(safe-area-inset-bottom));
    transform: translateX(-50%);
    /* Under every modal (they are at 100), over the pages. */
    z-index: 5;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    /* The partitions are gaps rather than drawn lines: they run the full height
       of the pill by construction, and what scrolls behind them stays visible. */
    gap: 2px;
    width: min(300px, calc(100% - 48px));
    height: var(--nav-height);
  }
  .tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 6px 4px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
    transition: color var(--transition);
    /* Solid, one tone below the cards. The pill itself is opaque -- only the
       partitions are open, and what scrolls behind those 2px stays visible. */
    background: var(--nav-bg);
  }
  /* The pill keeps one stadium silhouette: only the outer corners round off. */
  .tab:first-child {
    border-radius: 999px 0 0 999px;
  }
  .tab:last-child {
    border-radius: 0 999px 999px 0;
  }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); }
</style>
