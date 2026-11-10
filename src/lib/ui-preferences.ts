// How the app looks, as the browser last chose it: the colour scheme and
// whether the sidebar is collapsed. Both live in cookies, so the server
// renders the right one from the first paint, with no flash and no inline
// script. Read on the server and the client alike.

export const COLOR_SCHEME_COOKIE = "dossier_theme";
export const APP_THEME_COOKIE = "dossier_ui_theme";
export const SIDEBAR_COOKIE = "dossier_sidebar";

export const APP_THEMES = ["studio", "editorial"] as const;
export type AppTheme = (typeof APP_THEMES)[number];
export type Appearance = { theme: AppTheme; scheme?: ColorScheme };

/** Unknown and older browsers start in Studio. Document themes are unrelated. */
export function parseAppTheme(value: string | undefined): AppTheme {
  return value === "editorial" ? value : "studio";
}

export type ColorScheme = "light" | "dark";

/** The scheme the sidebar's switch chose; undefined follows the system. */
export function parseColorScheme(value: string | undefined): ColorScheme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/** Whether the sidebar was left collapsed. */
export function parseSidebarCollapsed(value: string | undefined): boolean {
  return value === "collapsed";
}

const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Remembers a preference for a year, from the browser. */
export function rememberPreference(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
}

function preference(name: string): string | undefined {
  return document.cookie.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
}

/** Read committed choices, so cancelling a preview also respects the sidebar's mode switch. */
export function browserAppearance(): Appearance {
  return { theme: parseAppTheme(preference(APP_THEME_COOKIE)), scheme: parseColorScheme(preference(COLOR_SCHEME_COOKIE)) };
}

/** Paint a preview without changing a cookie. Used for Apply, Cancel and navigation cleanup too. */
export function previewAppearance({ theme, scheme }: Appearance): void {
  document.documentElement.dataset.uiTheme = theme;
  if (scheme) document.documentElement.dataset.theme = scheme;
  else delete document.documentElement.dataset.theme;
  window.dispatchEvent(new Event("dossier:appearance"));
}

export function saveAppearance(appearance: Appearance): void {
  rememberPreference(APP_THEME_COOKIE, appearance.theme);
  if (appearance.scheme) rememberPreference(COLOR_SCHEME_COOKIE, appearance.scheme);
  else document.cookie = `${COLOR_SCHEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
  previewAppearance(appearance);
  window.dispatchEvent(new Event("dossier:appearance-saved"));
}

/** Quick mode switch commits only the scheme, even while a theme is being previewed. */
export function saveColorScheme(scheme: ColorScheme): void {
  rememberPreference(COLOR_SCHEME_COOKIE, scheme);
  previewAppearance({ theme: parseAppTheme(document.documentElement.dataset.uiTheme), scheme });
  window.dispatchEvent(new Event("dossier:appearance-saved"));
}
