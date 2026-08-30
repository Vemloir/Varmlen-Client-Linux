import { browser } from "$app/environment";

/** True inside the Android WebView (its UA contains "Android"; desktop
 *  WebKitGTK does not). Used to hide desktop-only UI on the mobile build. */
export const isAndroid = browser && /Android/i.test(navigator.userAgent);

/** True in the Linux desktop build, whose daemon owns the per-app split.
 *  Windows talks to its own service and Android to its VPN profile, so a
 *  live split update is a Linux-daemon call and nothing else. */
export const isLinux = browser && !isAndroid && /Linux|x11|wayland/i.test(navigator.userAgent);
