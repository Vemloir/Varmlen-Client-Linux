# Changelog

## Unreleased

- The "Hide locations" setting is gone. Hiding now has one behaviour: the row stays
  hidden until the user shows it again on the card, and the only other way back is
  removing the subscription and importing it again. A refresh -- background or
  explicit -- no longer restores anything, because a refresh is the provider's
  business and not the user's undo button.
- Revealing a card's hidden locations survives switching to Settings and back. The
  state lived in the page component, so navigating re-created it and the card
  forgot mid-reading that he had asked to see them. It now lives in the store, and
  drops with the subscription.
- The card's bottom line belongs to the "N hidden" / "Hide them again" button, not
  to the list: the button now spans the card, carries the separator a row carries,
  and centres its label, because it is a row-wide action and not a link in a
  sentence. The list ends where the last location ends, and the line exists only
  while there is something hidden to show.

- "Until the next update" is gone as a hiding mode. A background update is not
  something the user did, so hiding a location could undo itself while the app was
  simply open. Two modes are left: hidden until I refresh that card myself, and
  hidden until I show it again. Removing the subscription and importing it again
  always brings every location back -- a re-import is a new subscription, not a
  refresh of the old one -- so hiding stays durable without becoming
  unrecoverable. A stored `untilRefresh` falls back to the default.

- Hiding one location no longer hides the location behind it. Hiding and pinning
  were keyed by the ENDPOINT, and a provider can put two rows on one endpoint
  exactly -- the "auto choice" balancer of a JSON profile exposes the same first
  proxy outbound as the location behind it, so hiding «Finland | Helsinki» also hid
  «Автовыбор». A row is now keyed by endpoint AND label, the way the selection already
  resolves it: the row you pointed at is the row that goes away. Renaming a
  location brings back a hidden one and unpins a pinned one, because that row is
  gone under a new name. Keys written by older builds are rewritten to the row they
  can only have meant; when several rows share the old key the intent is lost, so
  those locations show again rather than stay hidden.
- The window stops behaving like a browser tab. Right-click no longer opens the
  WebView's Back / Forward / Stop / Reload menu (suppressed everywhere except
  editable fields, where Cut/Copy/Paste is still what the gesture means), and
  Backspace / Alt+arrow no longer walk through page history -- outside a field
  they are browser gestures, and a VPN window has no history to walk.
- One location menu for the whole app. The page owns it, so right-clicking in a
  second subscription replaces the open menu instead of stacking another one on
  top of it -- a per-card state could not know what the other card had opened.
- The menu is as wide as its longest item: `max-content` is not honoured the same
  way in every WebKitGTK build, so the width is measured from the item text and
  set explicitly before the menu is placed against the pointer.
- Settings controls take the application background (`--bg`) with no outline, and
  the number sits in the middle of its square.
- A pinned location goes to the TOP of the list and carries the same pin mark a
  pinned card carries -- a pin that sinks to the bottom is not a pin. The setting
  still orders the pinned ones among themselves.
- Settings controls are painted in the card's own background with no outline: a
  hovered row is `--bg-elev-2`, so the card colour reads on both row states. The
  number field is a square (as wide as it is tall). The location menu is finally
  as wide as its longest item and no wider -- `width: max-content` with the
  `min-width` that was still holding it open removed, and items on one line.
- Refreshing a subscription no longer throws the user onto "auto choice". Several
  providers put every location on ONE endpoint (`host:port:uuid`) and separate
  them only by transport, path, SNI or flow -- or by nothing at all, when an
  "auto choice" profile sits in front of the same four servers. The location key
  carried protocol, host, port, uuid, password and method, so all five entries
  hashed the same, and after a refresh regenerates the entry ids the resolver took
  the FIRST key match -- the balancer, which providers list first. The key now
  includes transport, security, SNI, flow, path and the WireGuard-ish identifiers,
  and an ambiguous key match is broken by the label the user chose, not by list
  order. Persisted keys from earlier builds stop matching once, which resolves the
  selection by label inside the same card.
- Hide-locations modes are three real choices instead of one and a half: "Until I
  refresh it myself" (default), "Until the next update" and "Until I show it
  again". "Never hide" was not a hiding mode; stored `always` migrates to `never`
  and stored `off` to the default.
- Settings controls are a darker chip with a border instead of the row's own tone:
  a hovered row is `--bg-elev-2`, and a dropdown painted `--bg-elev-2` on it simply
  disappeared. Same for the versions button and the new number field, which is also
  narrower and has its steppers removed (43 clicks to reach 43, and the arrows ate
  more room than the value). The location menu now sizes to its content instead of
  a fixed 220px, so an English menu does not pay for a Russian one; it is placed
  twice, from an estimate and then from its real box.
- The ✕ of a modal closes it on the first click. An icon-only button is clicked
  on its `<svg>`/`<path>`, and an SVGElement is not an `HTMLElement`, so the
  modal action resolver threw away every target that was not an HTML element --
  the ✕ answered only when the click happened to land on the button's own padding
  instead of the icon, which is why it looked like it worked once in a few tries
  while the text Cancel button closed instantly.
- Settings are split into what the app looks like and what the tunnel does:
  Interface (language, hiding, pinned order, tray and autostart) and VPN (mode,
  kill switch, LAN, ping method, simultaneous pings, subscription user agent and
  auto-update). Simultaneous pings is a number you type, not a list of five
  choices, and `0` means no limit without an infinity glyph next to it.
- Manual configurations are ordered between the pinned subscription and the rest.
- The location menu opens at the cursor -- its top-left corner where the pointer
  is, flipping to the left of the cursor and above it when there is no room --
  and no longer repeats the location name inside itself.
- A refresh of one subscription can no longer move the selection into another
  card. The endpoint and label fallbacks used to search every card when the
  chosen location's endpoint had rotated, so with the same endpoint sitting in two
  cards (a pasted link and a provider profile, or the same subscription imported
  twice) the choice landed in the other card. The card the user picked from now
  owns the choice while it exists; only when that card is removed may the choice
  be re-found elsewhere, and a location that is simply gone still reports itself
  as gone instead of being replaced.
- Locations got their own menu, and hiding is now a real thing. The right mouse
  button on a location (the menu key, Shift+F10, or a long press on a touch
  build) opens ping, rename, pin and hide -- until now a location could only be
  selected or opened, so hiding one junk entry out of a 20-location subscription
  meant editing the provider's JSON. Hiding and pinning key on the location's
  ENDPOINT (`protocol:host:port:uuid`), never on the entry id, because a refresh
  regenerates every id and a provider rotates the endpoint inside a profile: an
  id-keyed "hidden" list would forget what it hid. How long a hidden location
  stays hidden is a setting -- until the user refreshes the subscription himself
  (default; the background refresh keeps them hidden), until he shows it again,
  or hiding off. Pinned locations move into their own block ordered by the time
  they were pinned, never by measured latency, with the direction in settings.
  Revealing hidden locations is per card and temporary, and shows them dimmed
  without un-hiding anything.
- A manually added configuration now looks like a subscription minus the things
  it cannot do: no refresh, no ⋮ menu, no traffic bar, the header keeps only the
  ping. Nothing fetches such a card, so "update" and provider quota were lies on
  it. Its locations are DELETED rather than hidden, because nothing regenerates
  them, and the card that only held the last one goes with it.
- The list no longer steals the long press from the menu. Text in the location
  list is not selectable, which is what made Android haptic and show its
  selection handles on a press, and a press that turned into a scroll is dead for
  good -- any movement past 10px, any scroll, or a lift before 500ms kills the
  menu, including on release, so a swipe can never open one. Desktop opens on the
  right button with no timer at all.
- Three settings: hide mode, pinned-order direction, and simultaneous pings with
  `0` meaning no limit. The limit used to be fixed at 4 because every probe is
  its own short-lived xray process; a 20-location subscription now can be walked
  in one burst when the user accepts the memory and the server's patience.

  New pure modules `location-actions.ts` (menu contents, hiding, ordering) and
  `long-press.ts` (the gesture state machine) with 22 tests between them, and
  `location-menu.test.ts` locking the header and menu per card kind.
  vitest: 98 passed. svelte-check: 0 errors, 0 warnings.

- Ask a profile's resolver over a transport the proxy actually carries. Full
  JSON profiles hard-wire `8.8.8.8`-style UDP resolvers and the client forces
  every resolver connection through the selected proxy -- the anti-leak
  invariant -- but forwarded UDP/53 is what proxy servers routinely drop: across
  Proxen's fleet UDP DNS answered on 9 of 23 endpoints, TCP on 16 and DoH on 16,
  every endpoint that carried proxy traffic at all. The failure looked like
  "latency is green, nothing works": the tunnel is up, the resolver is not, so
  xray cannot resolve the observatory's own probe URL, the balancer keeps the
  profile's fallback outbound, and every lookup in every app hangs. Happ does
  not notice (it resolves through its own DoH) and neither does a client that
  sends the resolver direct, but both still leave UDP behind. A plain IP
  resolver now becomes DoH of the same operator first, then the same IP over
  TCP, then the provider's own UDP entry: one set per operator, still forced
  through the proxy, nothing substituted. With UDP/53 blocked in a test config,
  the old plan resolved 0 of 11 endpoints and the new one resolved 9 of 11 -- the
  two remaining do not carry proxy traffic either.
- The client no longer picks a different country by itself. A refresh regenerates
  every location id, so the chosen one was re-found by its endpoint
  (`protocol:host:port:uuid`) -- and a composite JSON profile exposes its FIRST
  proxy outbound as that host, which is exactly what a provider rotates: when
  Proxen moved the primary of «США», the stored endpoint matched nothing and the
  selection fell back to the first location of the first subscription, so the
  active location jumped to another country on its own. The selection is now
  re-found by endpoint and then by the location label inside the same
  subscription; a location that really vanished leaves nothing selected and says
  so instead of choosing another one, and its identity is kept, so an update that
  brings it back restores the choice.

- Locations stop turning into dead endpoints while the client is closed. The
  automatic subscription update waited for the next provider boundary strictly
  after the moment the application happened to start, and the application lives
  in the tray: a boundary crossed while the window was closed never came again,
  so the fetch never ran. A Proxen subscription on a four-hour interval kept the
  fleet of its last launch for two weeks, and every location whose address the
  provider had since retired -- the primary of "YouTube без рекламы" and of one
  Эстония -- failed the handshake while Happ, which refetches, worked. A
  subscription whose interval has already passed is now updated as soon as the
  client starts. The interval itself still decides the schedule of a client that
  stays open.
- Say that an update failed instead of quietly keeping the old list. A refresh
  that threw, or that came back parsing to no locations at all, left the
  subscription looking healthy with the previous servers and no trace of the
  failure; now the reason is stored, shown on the subscription card and in its
  info sheet, and retried after five minutes rather than every reschedule.

## 0.3.2

- Split rules now reach the tunnel that is already up. An application added to
  the exceptions used to keep going through the VPN, and one removed used to
  keep going direct, until the tunnel was cycled, because the rules travelled
  only inside a connect; the edited list is pushed to the running split.
- The split finds the applications it used to miss. A Windows game is named by
  the image inside its launcher's arguments -- Proton execs `wine64` and carries
  `REPO.exe` as a later word -- and a sandboxed application is claimed by its
  application id (`org.vinegarhq.Sober`) through the scope it runs in, which
  bubblewrap puts beyond the reach of exec notifications. A process is handed
  back only when the rule that moved it leaves the list: membership of the
  bypass cgroup is inherited, and ejecting an inherited member had cut a
  sandbox in half.
- Show the `JSON` marker on Hysteria2 locations too. A location edited as a
  provider profile says so whatever its transport; previously only VLESS and
  friends carried it, so Hysteria2 locations looked like share links.
- Reconnect no longer fails with "Xray rejected the generated configuration".
  Xray 26.3.x creates the TUN device while it is only *testing* a configuration,
  so validating a reconnect candidate against the interface that is still up was
  refused as `device or resource busy` and the user had to connect twice. The
  tun-bound syntax check is skipped while that interface is live, and the
  end-to-end egress probe still starts a real Xray through the candidate.
- Say what Xray actually complained about. Xray writes `Failed to start:` to
  stdout, so a stderr-only report arrived empty for every configuration error.
- Report a location as reachable when it is. The latency probe asks the
  profile's own DNS-over-HTTPS resolver a name through the same path and
  requires the answer, but `reqwest` was built without `http2`, so that request
  left as HTTP/1.1 and `9.9.9.9/dns-query` -- the resolver every profile
  without an explicit one falls back to -- answers `505` to exactly that. Every
  location on the default resolver read as dead, which is why it showed n/a
  right away while carrying traffic normally. A resolver that will not answer
  no longer hides its location either: it is asked in the first probe round and
  dropped in the second, which measures the proxy path alone, so a provider
  that refuses the resolver it does not sell costs the probe five seconds and
  not its latency.
- Accept the 15 s probe budget a UDP transport needs. The daemon refused any
  timeout above 10 s, so every Hysteria2, WireGuard, mKCP and QUIC location's
  latency probe was rejected before it ran and the location read as unpingable.
- Probe a location twice before declaring it dead, and report the reason the
  probe failed instead of "HTTP ping failed through every proxy path". An older
  daemon still answering a 24/7 tunnel gets the shorter probe it accepts instead
  of a rejection.

## 0.3.1

- Use hostname-based Cloudflare and Google DoH with static bootstrap addresses
  and parallel fallback, avoiding DNS stalls on routes that reject HTTPS to a
  bare IP while keeping every resolver connection inside the VPN.
- Accept provider hostname DNS only with an explicit public-IP bootstrap,
  preserve compatible provider DNS fields, and apply the Google APIs hostname
  compatibility mapping used by established Xray clients.
- Measure Hysteria2, WireGuard, mKCP and QUIC locations through their real
  proxy path instead of failing an inapplicable TCP-connect probe.
- Keep the package fallback on stable Xray 26.3.27. The first 0.3.1 assets
  briefly bundled prerelease 26.7.28 and were replaced; package upgrades move
  installations still on that default back to the bundled stable core while
  manually installed versions stay available for switching. Known trade-off:
  26.3.27 predates the Hysteria client-reuse and native-TUN UDP FullCone
  dataplane fixes, so QUIC-heavy apps on HY2 locations may remain partially
  offline.
- Preserve public literal-IP DNS servers from full JSON profiles, including
  ordinary UDP DNS such as `8.8.8.8`, and force them through the selected
  proxy instead of silently replacing them with Cloudflare DoH.
- Preserve a full JSON location's safe public DNS-over-HTTPS resolver instead
  of replacing it with Cloudflare, fixing Hysteria2 profiles whose tunnel can
  reach the provider resolver but not `1.1.1.1`.
- Require both HTTP and the location's effective resolver to work through the
  same concrete outbound before reporting latency, without making that
  synthetic probe a condition for connecting.
- Keep non-site provider routing such as protocol, public-IP, and port policy;
  Varmlen still owns website/app split, the final route, native TUN capture,
  LAN permission, and DNS leak prevention.

## 0.3.0

- Pin the package fallback to stable Xray 26.3.27 and always display it as a
  non-removable option, even when a newer downloaded core is active.
- Start the installed, root-owned networking daemon without asking the active
  desktop user for an administrator password again after every reboot.
- Treat every successful subscription response as authoritative: quota, usage,
  and expiry values omitted by the provider are now cleared instead of showing
  stale data from an earlier refresh.
- Harden the privileged daemon, subscription fetching, and IPC limits.
- Validate the final native Xray configuration and the selected profile's
  effective route before switching traffic; optional, fallback, balancer, and
  chained outbounds are no longer independently mandatory.
- Move validation-port ownership into the daemon, bound rotated logs, and keep
  protocol builders synchronized.
- Keep AppImage publishing paused until a safe standalone root-daemon bootstrap
  is available.

## 0.2.6

- Disable per-app split controls in Proxy mode and explain on hover, focus, or
  press that application routing requires TUN.
- Apply General and Selective website split rules to traffic sent through the
  local SOCKS proxy while keeping process rules out of Proxy mode.
- Remove the misleading manual Network permissions setup; privileged daemon
  startup remains lazy and is requested only by real operations.
- Correct the Proxy label and description to the actual SOCKS endpoint at
  `127.0.0.1:2081`.

## 0.2.5

- Add editable location details: exact source JSON for JSON profiles and
  structured parameters for URI-based locations.
- Refresh subscriptions only when their configured interval is due, allow
  automatic refresh to be disabled, and let provider updates replace local
  location edits.
- Add location dividers and a neutral globe for entries without a country flag,
  and remove the selected-location stripe.
- Make location dividers span the full card width using the page background
  color.
- Pretty-print valid location JSON in the editor and make reopening the same
  location toggle its details closed.
- Simplify protocol labels: show only Hysteria or Hysteria2 for those protocols
  and omit redundant REALITY suffixes.
- Rebuild the location editor around one modal lifecycle so JSON and structured
  editors can always be closed and reopened without stale touch layers.
- Populate finite editor fields from the Xray-supported protocol catalogue,
  including VMess, Trojan, Shadowsocks, Hysteria, WireGuard, HTTP, and SOCKS.
- Probe all locations concurrently and use the first healthy outbound from a
  composite JSON location instead of waiting on slower fallback paths.
- Keep long log lines inside the diagnostics dialog and draw a full-width
  divider above every location, including the first one.
- Build native DEB, RPM, and AppImage artifacts for both amd64 and arm64.

## 0.2.4

- Make one-shot HTTP latency checks use a composite location's deterministic
  fallback outbound instead of racing its cold load balancer and observatory.
- Match Xray's health-check request with an HTTP HEAD probe to the provider's
  gstatic 204 endpoint, reducing inflated latency and fixing Proxen USA probes.

## 0.2.3

- Send client-family subscription User-Agents as
  `<client>/<platform>/<architecture>` without an application version.
- Fix Happ and INCY compatibility with providers such as Proxen that select
  full Xray JSON profiles only when the client family is slash-delimited.
- Select bundled and downloadable Xray cores from the Linux target
  architecture instead of always assuming amd64.

## 0.2.2

- Preserve complete multi-outbound Xray profiles as one logical location,
  including provider balancers and observatories.
- Route every profile endpoint safely outside the Linux TUN and support
  balanced profiles in real HTTP latency checks.
- Add selectable Varmlen, Happ, INCY, and v2rayTun subscription User-Agents
  with a platform header and no app-version device churn.
- Keep provider JSON lossless and editable while retaining Varmlen's own DNS,
  split-tunnel, and kill-switch policy.
- Support Xray JSON outbounds for VLESS, VMess, Trojan, Shadowsocks, Hysteria,
  WireGuard, HTTP, and SOCKS; omit forbidden WireGuard stream settings.
- Stop grouping similarly named locations. Migrate local Configuration N cards
  into one flat Configuration/Configurations card without a network request.

## 0.2.1

- Use a stable platform-specific Varmlen subscription user agent without
  treating the app version as a separate device.
- Preserve provider location names, editable source JSON, and the exact Xray
  proxy outbound instead of flattening JSON subscriptions into a lossy model.
- Preserve Proxen XHTTP `extra`, mode, and XMUX settings.
- Group primary and backup variants under one expandable location.
- Accept Xray JSON outbounds for VMess, Trojan, Shadowsocks, Hysteria,
  WireGuard, HTTP, and SOCKS in addition to VLESS.
- Reject unsupported normalized protocols and transports instead of silently
  falling back to TCP.
- Reparse JSON already stored by 0.2.0 locally, without downloading the
  subscription again.
- Restore the AppImage for systems that already have Varmlen's privileged
  backend installed by the DEB or RPM package.

## 0.2.0

### Corrected Linux reissue

- Removed the fixed loopback DNS listener and its collision-prone port.
- Marked classic DNS traffic into a dedicated `varmlen0` policy route while
  keeping local stub resolvers reachable and blocking direct DNS/DoT fallback.
- Added independent recovery for the DNS policy route.
- Bumped the daemon protocol so the withdrawn port-based build is rejected
  before a connect command. Systems where that daemon is still running need one
  reboot after installing this corrected package.

### Security

- Replaced GUI-owned privileged networking with an authenticated, root-owned
  daemon and a bounded command protocol.
- Removed file capabilities and arbitrary privileged command/config paths.
- Made reconnect transactional and fail-closed, including crash recovery.
- Redirected system DNS into Xray and blocked direct DNS/DoT leakage even when
  LAN access is enabled, without requiring systemd-resolved.
- Added strict ownership, mode, listener, and configuration validation for
  privileged components.

### Split tunneling

- Applied bypass marks to both TCP and UDP sockets.
- Added cgroup-v2 process-tree tracking for native games and launchers.
- Added executable-open tracking for Proton/Windows game binaries.
- Added Flatpak command resolution and safe handling of existing sockets.

### Reliability

- Kept the tunnel alive independently of GUI restarts.
- Ignored stale frontend connection results after a newer disconnect/reconnect.
- Added daemon state recovery after GUI, Xray, or daemon crashes.
- Replaced per-ping Xray process launches with lightweight TCP probes.

### Packaging

- Added root-owned daemon, network helper, Xray, and polkit policy to DEB/RPM
  layouts.
- Removed duplicate privileged binaries from application resources.
- AppImage publishing is paused until a safe one-time daemon installer exists.
