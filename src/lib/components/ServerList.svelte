<script lang="ts">
  import { tick } from "svelte";
  import FlagIcon from "./FlagIcon.svelte";
  import { t } from "$lib/i18n.svelte";
  import { isAndroid } from "$lib/platform";
  import { placeAtPoint, portal } from "$lib/popup";
  import { createLongPress } from "$lib/long-press";
  import type { LocationAction } from "$lib/location-actions";
  import type { PingState, ServerEntry } from "$lib/subs.svelte";

  let {
    servers,
    selectedServerId,
    pings,
    hiddenIds = [],
    onSelect,
    onDetails,
    actionsFor,
    onAction,
  }: {
    servers: ServerEntry[];
    selectedServerId: string | null;
    pings: Record<string, PingState>;
    /** Entries the user hid; rendered dimmed while the card reveals them. */
    hiddenIds?: string[];
    onSelect: (id: string) => void;
    onDetails: (server: ServerEntry) => void;
    actionsFor: (server: ServerEntry) => LocationAction[];
    onAction: (action: LocationAction, server: ServerEntry) => void;
  } = $props();

  let openFor = $state<string | null>(null);
  let items = $state<LocationAction[]>([]);
  let target = $state<ServerEntry | null>(null);
  let pos = $state({ top: 0, left: 0 });

  const hiddenSet = $derived(new Set(hiddenIds));

  const LABELS: Record<LocationAction, () => string> = {
    ping: () => t("menu.ping"),
    rename: () => t("menu.rename"),
    pin: () => t("menu.pinLocation"),
    unpin: () => t("menu.unpinLocation"),
    hide: () => t("menu.hide"),
    unhide: () => t("menu.unhide"),
    delete: () => t("menu.deleteLocation"),
  };

  /** The row a finger is currently on — Android only. */
  let pendingRow: { server: ServerEntry; anchor: HTMLElement } | null = null;

  const press = createLongPress({
    onTrigger: (point) => {
      if (!pendingRow) return;
      openAt(pendingRow.server, point);
    },
  });

  /** The menu opens AT the pointer: its top-left corner is where the finger or
   *  the cursor is, flipping to the left/above when there is no room. It is placed
   *  twice -- once from an estimate, then from its real size, because the width
   *  depends on the language and a fixed 220px wastes the difference. */
  async function openAt(
    server: ServerEntry,
    point: { x: number; y: number },
  ): Promise<void> {
    target = server;
    items = actionsFor(server);
    pos = placeAtPoint(point.x, point.y, 180, items.length * 37 + 8);
    openFor = server.id;
    openedAt = Date.now();
    await tick();
    if (openFor !== server.id || !menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    pos = placeAtPoint(point.x, point.y, rect.width, rect.height);
  }

  let openedAt = 0;

  function closeMenu(): void {
    openFor = null;
    target = null;
  }

  function handleContextmenu(event: MouseEvent, server: ServerEntry) {
    if (isAndroid) return;
    event.preventDefault();
    openAt(server, { x: event.clientX, y: event.clientY });
  }

  function handleKeydown(event: KeyboardEvent, server: ServerEntry) {
    // The standard menu key, plus Shift+F10 where a keyboard has no such key.
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openAt(server, { x: rect.left, y: rect.bottom });
  }

  // Android: a press opens the menu after a delay, and dies the moment the list
  // moves under the finger. Desktop never arms this — right-click opens at once.
  function handlePointerdown(event: PointerEvent, server: ServerEntry) {
    if (!isAndroid || event.pointerType === "mouse") return;
    pendingRow = { server, anchor: event.currentTarget as HTMLElement };
    press.onPress(event.clientX, event.clientY);
  }

  function handlePointermove(event: PointerEvent) {
    if (!isAndroid) return;
    press.onMove(event.clientX, event.clientY);
  }

  function handlePointerup() {
    if (!isAndroid) return;
    press.onRelease();
  }

  function handleRowClick(server: ServerEntry): void {
    // A long press ends in a click as well; that click must not also select the
    // location the user meant to open a menu on.
    if (press.consumeClick()) return;
    onSelect(server.id);
  }

  $effect(() => {
    // Any scroll, anywhere, kills an armed press: if this same press already
    // scrolled the subscriptions, it must not open a menu.
    const onCancel = () => press.cancel();
    window.addEventListener("scroll", onCancel, true);
    return () => window.removeEventListener("scroll", onCancel, true);
  });

  $effect(() => {
    if (!openFor) return;
    const onDocClick = (e: Event) => {
      const node = e.target as Node | null;
      if (node && (menuEl?.contains(node) ?? false)) return;
      // The click that follows our own long press, and anything inside the same
      // gesture, must not close the menu we just opened.
      if (press.consumeClick()) return;
      if (Date.now() - openedAt < 250) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey);
    };
  });

  let menuEl: HTMLDivElement | undefined = $state();

  function run(action: LocationAction): void {
    if (target) onAction(action, target);
    closeMenu();
  }
</script>

<ul class="server-list">
  {#each servers as server (server.id)}
    {@const ping = pings[server.id]}
    {@const hidden = hiddenSet.has(server.id)}
    <li
      class="srv-row"
      class:active={selectedServerId === server.id}
      class:hidden-row={hidden}
    >
      <button
        class="srv-btn"
        aria-haspopup="menu"
        aria-expanded={openFor === server.id}
        onclick={() => handleRowClick(server)}
        oncontextmenu={(e) => handleContextmenu(e, server)}
        onkeydown={(e) => handleKeydown(e, server)}
        onpointerdown={(e) => handlePointerdown(e, server)}
        onpointermove={handlePointermove}
        onpointerup={handlePointerup}
        onpointercancel={handlePointerup}
      >
        <FlagIcon flag={server.flag ?? ""} />
        <div class="srv-info">
          <div class="srv-name">{server.name}</div>
          <div class="srv-tr dim">{server.transport}</div>
        </div>
      </button>
      <span class="srv-ping" aria-label="latency">
        {#if ping === "pinging"}
          …
        {:else if ping === "timeout"}
          {t("ping.na")}
        {:else if typeof ping === "number"}
          {t("ping.ms", { n: ping })}
        {/if}
      </span>
      <button
        class="srv-detail"
        aria-label="Location details"
        onclick={() => onDetails(server)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" class="chev" aria-hidden="true">
          <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </li>
  {/each}
</ul>

{#if openFor && target}
  <div
    class="loc-menu"
    class:loc-menu--animated={isAndroid}
    role="menu"
    use:portal
    style="top: {pos.top}px; left: {pos.left}px;"
    bind:this={menuEl}
  >
    {#each items as action (action)}
      <button
        role="menuitem"
        class="loc-menu-item"
        class:danger={action === "delete"}
        onclick={() => run(action)}
      >
        {LABELS[action]()}
      </button>
    {/each}
  </div>
{/if}

<style>
  .server-list {
    list-style: none;
    margin: 0;
    padding: 4px 0 0;
    /* A long press on text is the WebView's own "select text" gesture: it haptics
       and shows a selection handle, which is exactly what the location menu is
       trying to do. Take the text away from it. Inputs and the JSON editor keep
       theirs. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .srv-row {
    position: relative;
    display: flex;
    align-items: stretch;
    background: transparent;
    transition: background var(--transition);
  }
  .srv-row::before {
    content: "";
    position: absolute;
    z-index: 1;
    top: 0;
    left: 0;
    right: 0;
    border-top: 1px solid var(--bg);
    pointer-events: none;
  }
  @media (hover: hover) and (pointer: fine) {
    :global(html:not(.is-android)) .srv-row:not(.active):hover {
      background: var(--bg-elev-2);
    }
  }
  .srv-btn {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 4px 10px 14px;
    background: transparent;
    border: none;
    color: inherit;
    text-align: left;
    border-radius: 0;
  }
  .srv-detail {
    flex-shrink: 0;
    width: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text-dim);
  }
  @media (hover: hover) and (pointer: fine) {
    :global(html:not(.is-android)) .srv-detail:hover {
      color: var(--text);
    }
  }
  .srv-row.active { background: var(--accent-faint); }
  /* A hidden location, shown only while the card reveals them. */
  .srv-row.hidden-row .srv-btn,
  .srv-row.hidden-row .srv-ping { opacity: 0.45; }
  .srv-info { flex: 1; min-width: 0; }
  .srv-name {
    font-weight: 600;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .srv-tr {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 2px;
  }
  .chev { color: inherit; flex-shrink: 0; }
  .srv-ping {
    align-self: center;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    min-width: 44px;
    text-align: right;
    padding-right: 4px;
    color: var(--muted, #888);
  }

  .loc-menu {
    position: fixed;
    /* Explicit width: a fixed element with right set + width:auto stretches to
       the left edge in Android WebView instead of shrinking to its content. */
    /* Content width: a Russian menu and an English one are not the same width,
       and a fixed one pays for the difference in empty space. */
    width: max-content;
    min-width: 148px;
    max-width: min(260px, calc(100vw - 24px));
    background: var(--bg-elev-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
    padding: 4px;
    z-index: 210;
  }
  /* Android only: the menu answers a press, so it should arrive with motion.
     Desktop opens on right-click and must appear instantly. */
  .loc-menu--animated {
    animation: loc-menu-in 140ms ease-out;
    transform-origin: top right;
  }
  @keyframes loc-menu-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .loc-menu--animated { animation: none; }
  }
  .loc-menu-item {
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 13px;
  }
  .loc-menu-item:hover { background: var(--bg-elev-3); }
  .loc-menu-item.danger { color: var(--danger); }
</style>
