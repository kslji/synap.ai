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

export function persistThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    /* the boot script will fall back to the system theme next launch */
  }
  applyThemeChoice(choice)
}
