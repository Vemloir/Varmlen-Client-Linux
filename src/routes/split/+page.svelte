<script lang="ts">
  import { navPath } from "$lib/nav-path";
  import { tabOf, zoneOf } from "$lib/nav-zones";
  import { persistScroll } from "$lib/scroll-memory";
  import { onDestroy, tick } from "svelte";
  import { split, type Mode } from "$lib/split.svelte";
  import { settings } from "$lib/settings.svelte";
  import { appSplitAvailable } from "$lib/split-availability";
  import { listInstalledApps, appFromFile, pickFile, type InstalledApp } from "$lib/api";
  import { t } from "$lib/i18n.svelte";
  import { isAndroid } from "$lib/platform";
  import {
    isSitePattern,
    normalizeSitePattern,
    siteKindLabelKey,
    siteRuleKind,
  } from "$lib/site-pattern";
  import Dropdown from "$lib/components/Dropdown.svelte";

  interface Props {
    /** Path of the tab this page is standing in as; empty when it is the page. */
    preview?: string;
  }
  let { preview = "" }: Props = $props();

  /* The tab is the store's, not the page's: applications and websites are two places
     in the swipe strip that share this route, so the shell has to be able to read and
     move it. A preview shows the half its zone asks for and changes nothing -- two
     mounted copies of this page must not fight over the same state. */
  const previewTab = $derived(tabOf(preview));
  const tab = $derived(previewTab ?? split.tab);
  const appsAvailable = $derived(appSplitAvailable(settings.vpnMode));

  // The selector's sliding panel is measured, not guessed. Percentages inside a
  // segmented control resolve against a box that is not the pill the user sees
  // (measured on screen: the panel came out 6 px narrower than its own segment and
  // left a thicker frame on one side), and WebKitGTK disagrees with itself about
  // which box that is. So the active button's own offsetLeft/offsetWidth drive it,
  // the same way the location menu's width is measured instead of `max-content`.
  let segEl = $state<HTMLDivElement | undefined>();
  let thumbStyle = $state("");
  function syncThumb(): void {
    const host = segEl;
    if (!host) return;
    const btns = Array.from(host.querySelectorAll("button")) as HTMLElement[];
    if (btns.length === 0) return;
    const first = btns[0];
    const active = btns.find((b) => b.classList.contains("active")) ?? first;
    thumbStyle =
      `left: ${first.offsetLeft}px; width: ${active.offsetWidth}px; ` +
      `transform: translateX(${active.offsetLeft - first.offsetLeft}px);`;
  }
  let segResize: ResizeObserver | undefined;
  $effect(() => {
    tab;
    void tick().then(syncThumb);
    const host = segEl;
    if (host && !segResize && typeof ResizeObserver !== "undefined") {
      segResize = new ResizeObserver(() => syncThumb());
      segResize.observe(host);
    }
  });
  onDestroy(() => {
    segResize?.disconnect();
    segResize = undefined;
  });
  let showAppsUnavailable = $state(false);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function hideAppsUnavailableNotice(): void {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    noticeTimer = undefined;
    showAppsUnavailable = false;
  }

  function showAppsUnavailableNotice(): void {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    showAppsUnavailable = true;
    noticeTimer = setTimeout(() => {
      showAppsUnavailable = false;
      noticeTimer = undefined;
    }, 3000);
  }

  function requestAppsTab(event: Event): void {
    if (!appsAvailable) {
      showAppsUnavailableNotice();
      return;
    }
    if (event.type === "click") selectAppsTab();
  }

  function selectAppsTab(): void {
    if (!preview) split.setTab("apps");
  }

  function selectWebsitesTab(): void {
    if (!preview) split.setTab("websites");
    hideAppsUnavailableNotice();
  }

  $effect(() => {
    if (preview) return;
    if (!appsAvailable && split.tab === "apps") split.setTab("websites");
    if (appsAvailable) hideAppsUnavailableNotice();
  });

  onDestroy(hideAppsUnavailableNotice);

  const modeOptions = $derived([
    { value: "general", label: t("split.modeGeneral") },
    { value: "selective", label: t("split.modeSelective") },
  ]);

  // Adding a website is a window with one field: type a domain, press Add. The
  // placeholder carries the notation (a leading dot means a whole zone), so the
  // window needs neither a paragraph of instructions nor a list of suggestions.
  let siteDraft = $state("");
  let siteNotice = $state("");
  let showAddSite = $state(false);

  function openAddSite(): void {
    siteDraft = "";
    siteNotice = "";
    showAddSite = true;
  }
  function addSiteFromDraft(): void {
    const pattern = normalizeSitePattern(siteDraft);
    if (!pattern) return;
    if (!isSitePattern(pattern)) {
      // Not dropped silently: a stored pattern the router cannot match would sit in
      // the list looking like a rule while doing nothing.
      siteNotice = t("split.siteInvalid");
      return;
    }
    if (split.sites.some((s) => s.pattern === pattern)) {
      siteNotice = t("split.siteDuplicate");
      return;
    }
    split.addSite(pattern);
    // Closed on success: the row appearing in the list behind the window is the
    // confirmation. A refusal leaves the window open with the reason inside it.
    showAddSite = false;
  }
  let showAddApp = $state(false);
  let pickerQuery = $state("");
  let installed = $state<InstalledApp[]>([]);
  let pickerLoading = $state(false);
  // Apps tapped in the picker — committed only when the user confirms with Add.
  let selected = $state<Set<string>>(new Set());

  const addedIds = $derived(new Set(split.apps.map((a) => a.id)));
  const pickerResults = $derived.by(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return installed;
    return installed.filter(
      (a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
    );
  });

  async function openAddApp() {
    showAddApp = true;
    pickerQuery = "";
    selected = new Set();
    if (installed.length > 0) return;
    pickerLoading = true;
    // Let the modal paint before the (slow, first-time) app scan blocks on
    // PackageManager + icon rasterisation, so it opens instantly.
    await tick();
    try {
      installed = await listInstalledApps();
    } catch {
      installed = [];
    } finally {
      pickerLoading = false;
    }
  }

  function toggleSelect(app: InstalledApp) {
    const next = new Set(selected);
    if (next.has(app.id)) next.delete(app.id);
    else next.add(app.id);
    selected = next;
  }

  function confirmAdd() {
    for (const app of installed) {
      if (selected.has(app.id)) {
        split.addApp({ id: app.id, name: app.name, icon: app.icon ?? null });
      }
    }
    selected = new Set();
    showAddApp = false;
  }

  async function pickFromFile() {
    const picked = await pickFile();
    if (!picked) return;
    const app = await appFromFile(picked);
    if (app) {
      split.addApp({ id: app.id, name: app.name, icon: app.icon ?? null });
    }
    showAddApp = false;
  }

  // The mode card reflects the ACTIVE tab — apps and sites have independent
  // modes, so switching tabs shows (and edits) that category's mode + count.
  const activeMode = $derived(tab === "apps" ? split.appsMode : split.sitesMode);
  const enabledCount = $derived(
    tab === "apps"
      ? split.apps.filter((a) => a.enabled).length
      : split.sites.filter((s) => s.enabled).length,
  );
  const modeDescription = $derived(
    activeMode === "selective" ? t("split.mode.selective") : t("split.mode.general"),
  );
  function setActiveMode(m: Mode): void {
    if (tab === "apps") split.setAppsMode(m);
    else split.setSitesMode(m);
  }
</script>

<!-- An application without an icon gets no icon. A placeholder square with a
     generic box inside is decoration that tells the user nothing and pushes the
     name away from the row's edge. -->
{#snippet appIcon(icon: string | null | undefined)}
  {#if icon && icon.startsWith("data:")}
    <img class="app-icon" src={icon} alt="" />
  {:else if icon}
    <span class="app-icon">{icon}</span>
  {/if}
{/snippet}

<header class="topbar">
  <h1>{t("split.title")}</h1>
</header>

<div class="page" use:persistScroll={preview || zoneOf(navPath(), split.tab)}>

  <div class="segmented" role="tablist" bind:this={segEl}>
    <span class="seg-thumb" style={thumbStyle} aria-hidden="true"></span>
    <button
      class:active={tab === "apps"}
      class:unavailable={!appsAvailable}
      onclick={requestAppsTab}
      onmouseenter={requestAppsTab}
      onfocus={requestAppsTab}
      role="tab"
      aria-selected={tab === "apps"}
      aria-disabled={!appsAvailable}
    >{t("split.apps")}</button>
    <button
      class:active={tab === "websites"}
      onclick={selectWebsitesTab}
      role="tab"
      aria-selected={tab === "websites"}
    >{t("split.websites")}</button>
  </div>

  {#if showAppsUnavailable}
    <div class="split-unavailable" role="status" aria-live="polite">
      {t("split.appsProxyUnavailable")}
    </div>
  {/if}

  <div class="card mode">
    <div class="mode-top">
      <div class="mode-label">
        <div class="mode-title">{t("split.mode")}</div>
        <div class="muted small">{t("split.active", { n: enabledCount })}</div>
      </div>
      <Dropdown
        value={activeMode}
        options={modeOptions}
        onChange={(v) => setActiveMode(v as Mode)}
        ariaLabel={t("split.mode")}
      />
    </div>
    <p class="mode-note dim">{modeDescription}</p>
  </div>

  {#if tab === "apps"}
    <button class="btn panel-add" onclick={openAddApp}>{t("split.addApp")}</button>

    {#if split.apps.length === 0}
      <div class="empty-state">
        <div class="empty-title">{t("split.noAppsTitle")}</div>
        <div class="muted">{t("split.noAppsHint")}</div>
      </div>
    {:else}
      <div class="list">
        {#each split.apps as a (a.id)}
          <div class="list-row">
            {@render appIcon(a.icon)}
            <div class="app-text">
              <div class="app-name">{a.name}</div>
              <div class="app-id dim">{a.id}</div>
            </div>
            <button class="btn-ghost trash" onclick={() => split.removeApp(a.id)} aria-label="Remove">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            </button>
            <label class="switch">
              <input type="checkbox" checked={a.enabled} onchange={() => split.toggleApp(a.id)} />
              <span class="slider"></span>
            </label>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <button class="btn panel-add" onclick={openAddSite}>{t("split.addSites")}</button>

    {#if split.sites.length === 0}
      <div class="empty-state">
        <div class="empty-title">{t("split.noSitesTitle")}</div>
        <div class="muted">{t("split.noSitesHint")}</div>
      </div>
    {:else}
      <div class="list">
        {#each split.sites as s (s.id)}
          <!-- The meaning of the pattern is not a caption: the row says what is
               routed, and what the pattern covers is there for whoever asks. -->
          <div class="list-row" title={t(siteKindLabelKey(siteRuleKind(s.pattern)))}>
            <span class="pattern">{s.pattern}</span>
            <button class="btn-ghost trash" onclick={() => split.removeSite(s.id)} aria-label="Remove">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            </button>
            <label class="switch">
              <input type="checkbox" checked={s.enabled} onchange={() => split.toggleSite(s.id)} />
              <span class="slider"></span>
            </label>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

{#if showAddApp}
  <div class="modal-backdrop" onclick={() => (showAddApp = false)} role="presentation">
    <div
      class="modal card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === "Escape" && (showAddApp = false)}
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label={t("split.addApp")}
    >
      <header class="modal-head">
        <h2>{t("split.addApp")}</h2>
        <button class="icon-btn" onclick={() => (showAddApp = false)} aria-label={t("common.close")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </header>
      <input type="search" placeholder={t("split.searchInstalled")} bind:value={pickerQuery} />
      <div class="scan-bar" class:active={pickerLoading} aria-hidden="true">
        <div class="scan-fill"></div>
      </div>

      <div class="picker">
        {#if pickerLoading}
          <div class="picker-msg muted">{t("split.loadingApps")}</div>
        {:else if pickerResults.length === 0}
          <div class="picker-msg muted">
            {installed.length === 0 ? t("split.noInstalled") : t("split.noInstalledMatch")}
          </div>
        {:else}
          {#each pickerResults as app (app.id)}
            <button
              class="picker-row"
              class:selected={selected.has(app.id)}
              onclick={() => toggleSelect(app)}
              disabled={addedIds.has(app.id)}
            >
              {@render appIcon(app.icon)}
              <div class="app-text">
                <div class="app-name">{app.name}</div>
                <div class="app-id dim">{app.id}</div>
              </div>
              {#if addedIds.has(app.id) || selected.has(app.id)}
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5L10 17.5L19.5 8" stroke="var(--accent)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      {#if !isAndroid}
        <p class="muted small-note">{t("split.pickFileHint")}</p>
      {/if}
      <div class="modal-actions">
        {#if !isAndroid}
          <button class="btn" onclick={pickFromFile}>{t("split.chooseFile")}</button>
        {/if}
        <button class="btn" onclick={confirmAdd} disabled={selected.size === 0}>
          {t("split.addSelected", { n: selected.size })}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showAddSite}
  <div class="modal-backdrop" onclick={() => (showAddSite = false)} role="presentation">
    <div
      class="modal card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === "Escape" && (showAddSite = false)}
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label={t("split.addSites")}
    >
      <header class="modal-head">
        <h2>{t("split.addSites")}</h2>
        <button class="icon-btn" onclick={() => (showAddSite = false)} aria-label={t("common.close")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </header>

      <form class="site-add" onsubmit={(e) => { e.preventDefault(); addSiteFromDraft(); }}>
        <input
          type="text"
          placeholder={t("split.sitePlaceholder")}
          aria-label={t("split.sitePlaceholder")}
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
          bind:value={siteDraft}
        />
        <button class="btn" type="submit" disabled={!siteDraft.trim()}>{t("import.add")}</button>
      </form>
      {#if siteNotice}
        <p class="site-notice" role="status">{siteNotice}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .topbar {
    display: flex;
    align-items: center;
    padding: 14px 16px 6px;
    flex-shrink: 0;
  }
  .topbar h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
  }

  .page {
    position: absolute;
    inset: 56px 0 0 0;
    /* See +page.svelte for the rationale on always-on scrollbar + mirrored
       padding instead of `scrollbar-gutter: stable both-edges`. */
    overflow-y: scroll;
    /* A little air above the first row; the shell fades the bottom edge, not us. */
    padding: 12px 14px calc(24px + var(--nav-clearance)) 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* Keep the children at their natural height so a long apps/sites list makes
     the page overflow and scroll. Without this, `.list` (overflow:hidden →
     flex min-height:0) gets shrunk by the flex column and clips its rows
     instead of scrolling. */
  .page > :global(*) {
    flex-shrink: 0;
  }

  /* Tabs span the full width like every other panel. */
  .segmented {
    align-self: stretch;
    display: flex;
  }
  .segmented :global(button) {
    flex: 1;
  }

  .segmented :global(button.unavailable) {
    color: var(--text-muted);
    cursor: not-allowed;
    opacity: 0.55;
  }
  .segmented :global(button.unavailable:hover),
  .segmented :global(button.unavailable:focus-visible) {
    color: var(--text-muted);
  }
  .split-unavailable {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-elev-2);
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.4;
  }
  .small {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .mode {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mode-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .mode-label {
    min-width: 0;
  }
  .mode-title {
    font-size: 14px;
    font-weight: 600;
  }
  .mode-note {
    margin: 2px 0 0;
    font-size: 12px;
    padding: 8px 10px;
    /* The note sits INSIDE the panel, so it takes the app's own background. */
    background: var(--bg);
    border-radius: var(--radius-sm);
  }

  .site-add input {
    background: var(--bg-elev);
    border: none;
  }
  /* Adding is the only action either tab offers, so it takes the panel's whole
     width and the panel colour of everything around it -- a filled accent plate here
     would be the loudest thing on a tab whose content is the list. */
  .panel-add {
    width: 100%;
    /* One step above the page (--bg here would be the page itself, and the button
       would vanish). The app-background colour is used inside the card, where it
       reads as a cut-out; out here the plate has to be lighter than what it sits on. */
    background: var(--bg-elev);
    border: none;
  }
  .panel-add:hover:not(:disabled) {
    background: var(--bg-elev-2);
  }


  .site-notice {
    margin: -2px 0 0;
    font-size: 12px;
    color: var(--danger);
  }

  .empty-state {
    padding: 28px 18px;
    text-align: center;
    background: var(--bg-elev);
    border: none;
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .empty-title {
    font-weight: 600;
  }

  .app-icon {
    width: 30px;
    height: 30px;
    /* No rounded square behind the icon: the icon IS the thing. */
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
  }
  img.app-icon {
    object-fit: contain;
    padding: 3px;
  }
  .app-text {
    flex: 1;
    min-width: 0;
  }
  .app-name {
    font-weight: 500;
  }
  .app-id {
    font-size: 11px;
    font-family: ui-monospace, "JetBrains Mono", monospace;
    margin-top: 1px;
  }

  .site-add {
    display: flex;
    gap: 8px;
  }
  .site-add input {
    flex: 1;
    /* The application background, no outline: the card is the plate, the field and
       the button are cut out of it. */
    background: var(--bg);
    border: none;
  }
  .site-add .btn {
    background: var(--bg);
    border: none;
  }
  .site-add .btn:hover:not(:disabled) {
    background: var(--bg-elev-2);
  }

  .pattern {
    flex: 1;
    font-family: ui-monospace, "JetBrains Mono", monospace;
    font-size: 13px;
  }
  .trash {
    width: 28px;
    height: 28px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .trash:hover { color: var(--danger); }


  /* modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    display: flex;
    /* Centred: this is a desktop client, and a dialog that belongs to the window
       belongs in the middle of it. (The Android client keeps the sheet at the
       bottom edge, where it rides the keyboard up.) */
    align-items: center;
    justify-content: center;
    z-index: 100;
    animation: fadeIn var(--transition);
  }
  .modal {
    width: calc(100% - 24px);
    margin: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: slideUp 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .modal h2 { margin: 0; font-size: 17px; font-weight: 600; }
  .modal p { margin: 0; font-size: 13px; }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .icon-btn {
    background: transparent;
    border: 0;
    color: var(--text-muted);
    padding: 6px;
    border-radius: 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background var(--transition), color var(--transition);
  }
  .icon-btn:hover {
    background: var(--bg-elev-2);
    color: var(--text);
  }

  /* Indeterminate scan bar shown under the search while the app list loads. */
  .scan-bar {
    height: 0;
    overflow: hidden;
    border-radius: 2px;
    background: var(--bg);
    transition: height var(--transition);
  }
  .scan-bar.active {
    height: 3px;
    margin-top: 2px;
  }
  .scan-fill {
    height: 100%;
    width: 40%;
    border-radius: 2px;
    background: var(--accent);
    animation: scan 1.1s ease-in-out infinite;
  }
  /* Shifted, not margined: this animation runs forever while the list loads, and
     margin-left re-lays-out the modal on every frame. */
  @keyframes scan {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(250%); }
  }
  .picker {
    /* Fixed height: the modal keeps its size as the search narrows results,
       instead of shrinking/jumping. Matching apps fill top-to-bottom + scroll. */
    height: 52vh;
    overflow-y: auto;
    border: none;
    border-radius: var(--radius-sm);
    /* The application background: inside a card that is one step lighter, the plate
       reads as cut out of it rather than as a box glued on top. */
    background: var(--bg);
  }
  .picker-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: 0;
    text-align: left;
    color: var(--text);
    /* Only render rows near the viewport: the full installed-apps list (with an
       icon each) otherwise jank-renders at once and the WebView drops off-screen
       icons while scrolling. */
    content-visibility: auto;
    contain-intrinsic-size: auto 52px;
  }
  .picker-row + .picker-row {
    /* The separator used the panel colour while the panel was lighter than this;
       on a --bg plate the line has to be the lighter one. */
    border-top: 1px solid var(--bg-elev);
  }
  .picker-row:hover:not(:disabled) {
    background: var(--bg-elev);
  }
  .picker-row:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .picker-row.selected {
    background: var(--accent-faint);
  }
  .picker-msg {
    padding: 18px 12px;
    text-align: center;
    font-size: 13px;
  }
  .small-note {
    font-size: 12px;
  }
  .modal input[type="search"] {
    background: var(--bg);
    border: none;
  }
  .modal-actions .btn {
    background: var(--bg);
    border: none;
  }
  .modal-actions .btn:hover:not(:disabled) {
    background: var(--bg-elev-2);
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
</style>
