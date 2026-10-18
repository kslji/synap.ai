export type ThemeChoice = 'light' | 'dark'

/** Shared with theme-boot.js in the desktop and website. */
export const THEME_STORAGE_KEY = 'surf-theme'

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'dark') return 'dark'
    if (saved === 'system') localStorage.setItem(THEME_STORAGE_KEY, 'light')
  } catch {
    /* private mode or a blocked store */
  }
  return 'light'
}

export function applyThemeChoice(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = choice === 'dark' ? 'dark' : 'light'
}

/**
 * The painted theme wins. The switch can be given a stale value when the
 * document theme was set without a matching settings update.
 */
export function themeSwitchChoice(applied: string | null | undefined, fallback: ThemeChoice): ThemeChoice {
  if (applied === 'light' || applied === 'dark') return applied
  return fallback === 'dark' ? 'dark' : 'light'
}

export function persistThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    /* the boot script will fall back to the system theme next launch */
  }
  applyThemeChoice(choice)
}
