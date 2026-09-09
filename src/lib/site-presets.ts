/**
 * Suggestions and input normalisation for the websites picker.
 *
 * A pattern is stored the way the router reads it (see `xray.rs`, "Per-site
 * split"): `*.example.com` becomes a suffix match, which also covers
 * `example.com` itself, while `example.com` is an exact match of that one host.
 * Every preset is therefore written as a wildcard -- a bare `google.com` would
 * route only the apex host and leave `www` and `mail` on the tunnel, which is the
 * opposite of what someone who typed "google.com" expects.
 */

export type SitePresetGroup = {
  id: string;
  labelKey: string;
  patterns: string[];
};

/**
 * Country blocks come first because one entry covers every host under a ccTLD,
 * which is what split tunnelling is actually used for; services come second for
 * people who list a handful of hosts instead. `*.ir` is in the region list on
 * purpose: domestic Iranian hosts are the entries an Iranian user keeps direct.
 */
export const SITE_PRESET_GROUPS: SitePresetGroup[] = [
  {
    id: "region",
    labelKey: "split.presetRegion",
    patterns: ["*.ru", "*.su", "*.by", "*.kz", "*.ua", "*.uz", "*.ir", "*.cn"],
  },
  {
    id: "services",
    labelKey: "split.presetServices",
    patterns: [
      "*.google.com",
      "*.youtube.com",
      "*.googlevideo.com",
      "*.github.com",
      "*.twitch.tv",
      "*.discord.com",
    ],
  },
];

/**
 * Clean what was typed into a host pattern: surrounding space, a scheme, a path,
 * a query, a fragment, the `user@` of a URL with credentials, and the trailing dot
 * of a fully qualified name.
 * Someone pasting `https://example.com/vpn` means `example.com`, and storing the
 * pasted string would create a rule that matches nothing and silently does
 * nothing -- a lie inside our own feature.
 */
export function normalizeSitePattern(value: string): string {
  let v = value.trim().toLowerCase();
  if (!v) return "";
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  v = v.split(/[/?#]/)[0];
  const at = v.lastIndexOf("@");
  if (at >= 0) v = v.slice(at + 1);
  v = v.replace(/\.+$/, "");
  return v.trim();
}

/**
 * A host, or a `*.host` wildcard. A port is refused rather than dropped: the
 * router matches domains, so `example.com:8080` cannot mean anything here, and
 * quietly turning it into `example.com` would hide a misunderstanding.
 */
export function isSitePattern(value: string): boolean {
  const v = normalizeSitePattern(value);
  if (!v) return false;
  const wildcard = v.startsWith("*.");
  const host = wildcard ? v.slice(2) : v;
  if (!host) return false;
  const labels = host.split(".");
  if (labels.some((label) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label))) return false;
  // No registered top-level label is a single character, so `example.c` is a
  // mistake, not a domain.
  if (labels[labels.length - 1].length < 2) return false;
  // An exact match has to name a whole domain; only the wildcard form may name a
  // zone, which is how `*.ru` covers a whole country's hosts.
  return wildcard || labels.length >= 2;
}

/**
 * Presets minus what is already listed. An entry that is already in the list is
 * not a suggestion, it is a fact about the list, and offering it again invites a
 * duplicate that `addSite` would silently swallow.
 */
export function suggestSiteGroups(existing: string[]): SitePresetGroup[] {
  const have = new Set(existing.map(normalizeSitePattern).filter(Boolean));
  return SITE_PRESET_GROUPS.map((group) => ({
    ...group,
    patterns: group.patterns.filter((pattern) => !have.has(normalizeSitePattern(pattern))),
  })).filter((group) => group.patterns.length > 0);
}