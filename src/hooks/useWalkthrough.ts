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

/** First-run guided tour. Starts by itself, once each, the first time the
 * user sees the upload screen and the first time a document opens; skipping
 * or finishing is remembered (see lib/walkthrough.ts). If the screen changes
 * mid-tour (e.g. a file is dropped during the intro) the tour is torn down.
 *
 * Returns `restartWalkthrough`, which replays whichever phase matches the
 * current screen - this is what the Help button will call once it's wired up;
 * nothing consumes it yet. */
export function useWalkthrough(status: WorkspaceStatus) {
  const activeRef = useRef<WalkthroughHandle | null>(null)

  const start = useCallback((kind: WalkthroughKind) => {
    activeRef.current?.destroy()
    activeRef.current = runWalkthrough(kind, (reason) => {
      activeRef.current = null
      recordWalkthroughEnd(kind, reason)
    })
  }, [])

  useEffect(() => {
    const kind: WalkthroughKind | null = status === 'empty' ? 'landing' : status === 'loaded' ? 'workspace' : null
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
    if (status === 'empty') start('landing')
    else if (status === 'loaded') start('workspace')
  }, [status, start])

  return { restartWalkthrough }
}
