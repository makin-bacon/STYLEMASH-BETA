import { useState } from 'react'
import { AboutModal } from './AboutModal'

interface AppHeaderProps {
  filename: string | null
  /** Whether the "Customise your own style file" checklist is currently
   * expanded inside the New Styles panel (see UserStylesPanel /
   * DefaultStylesChecklist) - this button only toggles that visibility, it
   * owns none of the checklist's own state. Lifted to App.tsx since the
   * button and the panel it controls are siblings. */
  isCustomizeOpen: boolean
  onToggleCustomize: () => void
  /** "Help" starts the guided tour for the current screen (see
   * useWalkthrough#restartWalkthrough). The neighbouring "About" button opens
   * the written About modal instead, whose open state lives here. */
  onHelp: () => void
}

/** Top bar: app name, currently-loaded filename, "Customise your own style
 * file", Help (guided tour) and About (modal). The "load a different file" action lives on
 * StyleReportPanel's header instead of here - see StyleReportPanel's
 * "Mash a different file" button. */
export function AppHeader({ filename, isCustomizeOpen, onToggleCustomize, onHelp }: AppHeaderProps) {
  const [isAboutOpen, setIsAboutOpen] = useState(false)

  return (
    <header className="flex items-center justify-between border-b border-line bg-chrome px-6 py-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-chrome-fg">
          {/* StyleMash's own mark (see /favicon.svg) - inlined as JSX rather
              than an <img> so its fill="currentColor" keeps inheriting this
              heading's text color, same as the FontAwesome glyph it
              replaces did. */}
          <svg viewBox="0 0 640 640" className="h-4 w-4" aria-hidden="true">
            <path
              fill="currentColor"
              d="M40 200C40 89.5 129.5 0 240 0L580 0c11 0 20 9 20 20s-9 20-20 20l-60 0 0 580c0 11-9 20-20 20s-20-9-20-20l0-580-80 0 0 580c0 11-9 20-20 20s-20-9-20-20l0-220-25.8 0c-7.2-14.5-16-27.9-26.1-40l51.9 0 0-320-120 0c-88.4 0-160 71.6-160 160 0 33.8 10.5 65.1 28.3 90.9-13.9 3.1-27 7.5-39.2 13.1-18.5-30.3-29.1-65.9-29.1-104zM0 487c0-84.5 68.5-153 153-153S306 402.5 306 487 237.5 640 153 640 0 571.5 0 487zM153 368C87.3 368 34 421.3 34 487s53.3 119 119 119 119-53.3 119-119-53.3-119-119-119zm37.3 58c5.5-7.6 16.2-9.3 23.7-3.7s9.3 16.2 3.7 23.7l-68 93.5c-2.9 4-7.5 6.6-12.4 6.9s-9.8-1.4-13.4-4.9L81.5 499c-6.6-6.6-6.6-17.4 0-24s17.4-6.6 24 0L134 503.4 190.3 426z"
            />
          </svg>
          <span className="flex items-baseline gap-1.5">
            <span>StyleMash</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-green-400">
              Beta
            </span>
          </span>
        </h1>
        {filename && <p className="text-xs text-chrome-dim">CURRENTLY MASHING: {filename}</p>}
      </div>

      <div className="flex items-center gap-3">
        {/* Only meaningful once a document is loaded - it toggles a
            checklist inside the New Styles panel, and that panel doesn't
            exist on the upload screen. `filename` is already null exactly
            when nothing's loaded (see App.tsx), so it doubles as the gate
            here without a redundant prop. */}
        {filename && (
          <button
            type="button"
            onClick={onToggleCustomize}
            aria-pressed={isCustomizeOpen}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              isCustomizeOpen
                ? 'border-violet-400 bg-violet-600 text-white hover:bg-violet-700'
                : 'border-chrome-edge text-chrome-fg hover:bg-chrome-hover'
            }`}
          >
            Customise your own style file
          </button>
        )}
        <button
          type="button"
          onClick={onHelp}
          title="Take a quick guided tour"
          className="rounded-md border border-chrome-edge px-3 py-1.5 text-xs font-medium text-chrome-fg hover:bg-chrome-hover"
        >
          Help
        </button>
        <button
          type="button"
          onClick={() => setIsAboutOpen(true)}
          className="rounded-md border border-chrome-edge px-3 py-1.5 text-xs font-medium text-chrome-fg hover:bg-chrome-hover"
        >
          About
        </button>
      </div>

      {isAboutOpen && <AboutModal onClose={() => setIsAboutOpen(false)} />}
    </header>
  )
}
