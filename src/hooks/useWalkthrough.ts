import { useCallback, useEffect, useRef } from 'react'
import {
  hasSeenWalkthrough,
  isWalkthroughForced,
  recordWalkthroughEnd,
  runWalkthrough,
  type WalkthroughHandle,
  type WalkthroughKind,
} from '../lib/walkthrough'

type WorkspaceStatus = 'empty' | 'loading' | 'loaded' | 'error'

// Let the page-transition fade-in (500ms, see index.css) settle first, so the
// spotlight lands on elements that are fully in place.
const START_DELAY_MS: Record<WalkthroughKind, number> = { landing: 600, workspace: 900 }

interface WalkthroughOptions {
  /** Opens the written help; wired to the tour's closing "Read the full help"
   * link. Without it, that link is left out. */
  onOpenHelp?: () => void
}

/** First-run guided tour. Starts by itself, once each, the first time the
 * user sees the upload screen and the first time a document opens; skipping
 * or finishing is remembered (see lib/walkthrough.ts). If the screen changes
 * mid-tour (e.g. a file is dropped during the intro) the tour is torn down.
 *
 * Returns `restartWalkthrough`, which replays whichever phase matches the
 * current screen - the header's Help button calls it. It does nothing while a
 * file is mid-load (there's nothing on screen to point at). */
export function useWalkthrough(status: WorkspaceStatus, options: WalkthroughOptions = {}) {
  const activeRef = useRef<WalkthroughHandle | null>(null)
  // Read through a ref so a new callback identity each render doesn't restart
  // the tour (the effect below depends on `start`).
  const onOpenHelpRef = useRef(options.onOpenHelp)
  onOpenHelpRef.current = options.onOpenHelp

  const start = useCallback((kind: WalkthroughKind) => {
    activeRef.current?.destroy()
    activeRef.current = runWalkthrough(
      kind,
      (reason) => {
        activeRef.current = null
        recordWalkthroughEnd(kind, reason)
      },
      { onOpenHelp: onOpenHelpRef.current ? () => onOpenHelpRef.current?.() : undefined },
    )
  }, [])

  useEffect(() => {
    // 'error' still shows the upload screen (with its message), so it gets the
    // upload-screen intro like 'empty' does.
    const kind: WalkthroughKind | null =
      status === 'empty' || status === 'error' ? 'landing' : status === 'loaded' ? 'workspace' : null
    if (!kind) return
    if (!isWalkthroughForced() && hasSeenWalkthrough(kind)) return

    const timer = window.setTimeout(() => start(kind), START_DELAY_MS[kind])
    return () => {
      window.clearTimeout(timer)
      activeRef.current?.destroy()
      activeRef.current = null
    }
  }, [status, start])

  const restartWalkthrough = useCallback(() => {
    if (status === 'empty' || status === 'error') start('landing')
    else if (status === 'loaded') start('workspace')
  }, [status, start])

  return { restartWalkthrough }
}
