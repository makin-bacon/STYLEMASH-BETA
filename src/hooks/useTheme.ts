import { useCallback, useEffect, useRef, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'stylemash-theme'
const FADE_DURATION_MS = 350

/** Saved choice first, then the OS preference. Mirrors the inline script in
 * index.html, which applies the same logic before first paint. */
function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage blocked (private window etc.) - fall through to the OS setting.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/** Light/dark theme state, persisted, applied as a `dark` class on <html>.
 *
 * Switching cross-fades every color: a short-lived `theme-fading` class on
 * <html> (see index.css) turns on color transitions for the whole page just
 * around the class flip, then comes off again so it can't interfere with the
 * app's own hover/selection transitions. prefers-reduced-motion users get an
 * instant change. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)
  const fadeTimer = useRef<number | undefined>(undefined)

  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => () => window.clearTimeout(fadeTimer.current), [])

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not persisted - still switches for this session.
    }

    const root = document.documentElement
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      window.clearTimeout(fadeTimer.current)
      root.classList.add('theme-fading')
      fadeTimer.current = window.setTimeout(
        () => root.classList.remove('theme-fading'),
        FADE_DURATION_MS + 100,
      )
    }
    setTheme(next)
    // Applied here as well as in the effect so the class flips in the same
    // frame the fade class was added (the effect would run a frame later).
    applyTheme(next)
  }, [theme])

  return { theme, isDark: theme === 'dark', toggle }
}
