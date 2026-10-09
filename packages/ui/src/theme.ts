export type ThemeChoice = 'system' | 'light' | 'dark'

/** Shared with theme-boot.js in the desktop and website. */
export const THEME_STORAGE_KEY = 'surf-theme'

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    /* private mode or a blocked store */
  }
  return 'system'
}

export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = choice
}

export function persistThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    /* the boot script will fall back to the system theme next launch */
  }
  applyThemeChoice(choice)
}
