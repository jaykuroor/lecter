/**
 * Whether the app runs on macOS, where `<Mod-…>` keys use Cmd (10-keymap.md#global-os-conventions).
 * The platform decides; the user agent only when the platform is blank. A user agent can claim a
 * Mac anywhere (WebKit on Linux often sends Safari's), and trusting it would leave Ctrl keys dead
 * there.
 */
export function isMacPlatform(nav: Pick<Navigator, "platform" | "userAgent"> = navigator): boolean {
  return nav.platform ? /Mac/.test(nav.platform) : /Macintosh/.test(nav.userAgent);
}
