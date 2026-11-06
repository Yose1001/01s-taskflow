// Theme logic with no React in it, so it is easy to test.
// index.html runs a tiny script with the same rules before the first paint (keep them in sync).
//
// There are exactly two themes: light and dark. The FIRST time someone opens the app (nothing saved yet)
// we start from what their device prefers; after that the choice they make is saved and always wins.

export type Theme = 'light' | 'dark'

export const THEMES: readonly Theme[] = ['light', 'dark']
export const THEME_STORAGE_KEY = 'tf-theme'

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/** The saved choice, or null when nothing valid is saved (or storage is blocked). Old values such as "system" count as nothing. */
export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage can be blocked (private mode): the theme still works for this visit.
  }
}

export function devicePrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

/** The theme to show on load: the saved choice, otherwise the device preference. */
export function initialTheme(): Theme {
  return readStoredTheme() ?? (devicePrefersDark() ? 'dark' : 'light')
}

/** Puts the theme on <html data-theme="...">, which the CSS variables listen to. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}
