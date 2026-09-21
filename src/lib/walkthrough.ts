import { driver, type Config, type DriveStep, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { MULTI_SELECT_KEY } from './platform'

/** The first-run guided tour, built on driver.js (spotlight + popover with
 * animated transitions, Back/Next/Skip, progress and arrow-key/Esc support).
 *
 * It runs in two phases because the app has two screens: a one-step intro on
 * the upload screen ("drop a file here"), then - once a document is open - a
 * four-step tour of the workspace. Steps point at elements by
 * `data-tour="..."` attributes, so markup can move without touching this. */

export type WalkthroughKind = 'landing' | 'workspace'
export type WalkthroughEnd = 'completed' | 'skipped'

const STORAGE_KEYS: Record<WalkthroughKind, string> = {
  landing: 'stylemash-tour-landing',
  workspace: 'stylemash-tour-workspace',
}

const target = (name: string) => `[data-tour="${name}"]`

export const LANDING_STEPS: DriveStep[] = [
  {
    element: target('dropzone'),
    popover: {
      title: 'Start with a Word file',
      description:
        "Drop a <strong>.docx</strong> or <strong>.dotx</strong> here, or click to browse. It's read right in your browser - nothing is uploaded. We'll show you around once it's open.",
      side: 'bottom',
      align: 'center',
    },
  },
]

export const WORKSPACE_STEPS: DriveStep[] = [
  {
    element: target('preview'),
    popover: {
      title: 'Your document, style by style',
      description: `Click any text to select its style - every place it's used lights up. Hold <strong>${MULTI_SELECT_KEY}</strong> to select several.`,
      side: 'right',
      align: 'start',
    },
  },
  {
    element: target('current-styles'),
    popover: {
      title: 'Every look in your file',
      description:
        'Each distinct text appearance is listed here, most common first. Tick the ones you want to standardise.',
      side: 'right',
      align: 'start',
    },
  },
  {
    element: target('new-styles'),
    popover: {
      title: 'Choose where it should end up',
      description:
        'Add a starter set with <strong>+ Defaults</strong>, build your own with <strong>+ New Style</strong>, or attach the styles from another Word file. Click a style to make it the target.',
      side: 'left',
      align: 'start',
    },
  },
  {
    element: target('mash-footer'),
    popover: {
      title: 'Mash it, then save',
      description:
        "Down here, <strong>Mash it</strong> folds your selection into the target style (<strong>Undo</strong> is right beside it). Repeat until you're happy, then <strong>Save your file</strong>.",
      side: 'left',
      align: 'end',
    },
  },
]

// ---- "Have they seen it?" persistence -----------------------------------

export function hasSeenWalkthrough(kind: WalkthroughKind): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS[kind]) === '1'
  } catch {
    return false
  }
}

function markSeen(kind: WalkthroughKind) {
  try {
    localStorage.setItem(STORAGE_KEYS[kind], '1')
  } catch {
    // Storage blocked - the tour may show again next visit; harmless.
  }
}

/** Records how a phase ended. Skipping anywhere means "don't show me any of
 * this again", so it also marks the phases the user hasn't reached yet.
 * Reaching the workspace phase at all implies the upload intro is behind them
 * (it's torn down silently when a file loads, so it never reports its own end). */
export function recordWalkthroughEnd(kind: WalkthroughKind, reason: WalkthroughEnd) {
  markSeen(kind)
  if (kind === 'workspace' || reason === 'skipped') {
    markSeen('landing')
    markSeen('workspace')
  }
}

/** `?tour` in the URL forces the tour to run regardless of what's been seen -
 * for reviewing/demoing it. (The header's Help button replays it too.) */
export function isWalkthroughForced(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tour')
}

// ---- Running a tour -----------------------------------------------------

export interface WalkthroughHandle {
  /** Tear the tour down without reporting an end (e.g. the screen changed). */
  destroy: () => void
}

/** Starts a tour and returns a handle. `onEnd` fires exactly once, when the
 * user finishes ("completed") or dismisses it by any route - the X, Esc, or
 * the Skip link ("skipped"). Clicking the dimmed backdrop does nothing, so a
 * stray click can't throw the tour away. */
export function runWalkthrough(
  kind: WalkthroughKind,
  onEnd: (reason: WalkthroughEnd) => void,
): WalkthroughHandle {
  const steps = kind === 'landing' ? LANDING_STEPS : WORKSPACE_STEPS
  const isSingleStep = steps.length === 1
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

  let finished = false
  let tour: Driver | undefined
  const finish = (reason: WalkthroughEnd) => {
    if (finished) return
    finished = true
    tour?.destroy()
    onEnd(reason)
  }

  const config: Config = {
    steps: steps.map((step, i) => {
      const isLast = i === steps.length - 1
      return {
        ...step,
        popover: {
          ...step.popover,
          // The last step's primary button is "Done" (or "Got it" for the
          // one-step intro) and ends the tour as completed, not skipped.
          ...(isLast
            ? { doneBtnText: isSingleStep ? 'Got it' : 'Done', onNextClick: () => finish('completed') }
            : {}),
        },
      }
    }),
    animate: !reduceMotion,
    smoothScroll: !reduceMotion,
    showProgress: !isSingleStep,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    showButtons: isSingleStep ? ['next', 'close'] : ['previous', 'next', 'close'],
    allowClose: true,
    allowKeyboardControl: true,
    overlayColor: '#020617',
    overlayOpacity: 0.62,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: 'sm-tour',
    skipMissingElement: true,
    overlayClickBehavior: () => {},
    onDestroyStarted: () => finish('skipped'),
    onPopoverRender: (popover, { driver: d }) => {
      // An explicit "Skip tour" link on every step but the last, alongside the
      // X and Esc, so leaving is never more than one obvious click away.
      if (isSingleStep || !d.hasNextStep()) return
      const skip = document.createElement('button')
      skip.type = 'button'
      skip.className = 'sm-tour-skip'
      skip.textContent = 'Skip tour'
      skip.addEventListener('click', () => finish('skipped'))
      popover.footer.insertBefore(skip, popover.footerButtons)
    },
  }

  tour = driver(config)
  tour.drive()

  return {
    destroy: () => {
      finished = true
      tour?.destroy()
    },
  }
}
