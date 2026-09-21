import { ThemeToggle } from './ThemeToggle'

interface AppFooterProps {
  isDark: boolean
  onToggleTheme: () => void
}

/** Persistent bottom-of-page privacy note - shown regardless of workspace
 * state (upload screen or loaded workspace), so it's always visible rather
 * than only while the dropzone is on screen. The light/dark switch sits at
 * the far right; the note stays centered via the 1fr/auto/1fr grid. */
export function AppFooter({ isDark, onToggleTheme }: AppFooterProps) {
  return (
    <footer className="grid grid-cols-[1fr_auto_1fr] items-center border-t border-line bg-chrome px-6 py-4 text-sm text-chrome-fg">
      <span aria-hidden="true" />
      <p className="text-center">
        Everything happens locally in your browser - files are never uploaded anywhere.
        <span className="text-chrome-muted"> · v.0.1.1-beta</span>
      </p>
      <div className="justify-self-end">
        <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
      </div>
    </footer>
  )
}
