import { faMoon, faSun } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

interface ThemeToggleProps {
  isDark: boolean
  onToggle: () => void
}

/** Light/dark switch, in the app's own palette (slate + white only). All
 * motion is CSS keyed off `isDark`: the knob slides with a small overshoot,
 * the sun spins out as the moon spins in, the track eases from mid to deep
 * slate, and a few stars fade in and twinkle (a pair of soft clouds fades
 * out). Reduced-motion users get the same end states with no movement - see
 * `.theme-toggle` in index.css. */
export function ThemeToggle({ isDark, onToggle }: ThemeToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Dark mode"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={onToggle}
      className="theme-toggle relative h-7 w-14 shrink-0 cursor-pointer overflow-hidden rounded-full border border-chrome-edge focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-chrome"
    >
      {/* Track: mid slate underneath, deep slate fading in on top (day = dark-ish, night = darker). */}
      <span className="absolute inset-0 bg-linear-to-r from-slate-600 to-slate-500" aria-hidden="true" />
      <span
        className={`absolute inset-0 bg-linear-to-r from-slate-950 to-slate-800 transition-opacity duration-500 ${
          isDark ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden="true"
      />

      {/* Clouds (day only), on the side the knob has left. */}
      <span
        className={`absolute right-1.5 top-3.5 h-2 w-4 rounded-full bg-slate-400 transition-all duration-500 ${
          isDark ? 'translate-x-3 opacity-0' : 'opacity-100'
        }`}
        aria-hidden="true"
      />
      <span
        className={`absolute right-4 top-1.5 h-1.5 w-3 rounded-full bg-slate-400/80 transition-all delay-75 duration-500 ${
          isDark ? 'translate-x-3 opacity-0' : 'opacity-100'
        }`}
        aria-hidden="true"
      />

      {/* Stars (night only). */}
      {[
        { left: '0.55rem', top: '0.5rem', size: 'h-[3px] w-[3px]', delay: '0s' },
        { left: '1.35rem', top: '1.2rem', size: 'h-0.5 w-0.5', delay: '0.6s' },
        { left: '0.9rem', top: '1.5rem', size: 'h-[3px] w-[3px]', delay: '1.1s' },
        { left: '1.9rem', top: '0.45rem', size: 'h-0.5 w-0.5', delay: '0.3s' },
      ].map((star) => (
        <span
          key={star.left}
          className={`absolute rounded-full bg-white transition-opacity duration-500 ${star.size} ${
            isDark ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            left: star.left,
            top: star.top,
            animation: isDark ? `star-twinkle 2.4s ease-in-out ${star.delay} infinite` : undefined,
          }}
          aria-hidden="true"
        />
      ))}

      {/* Knob: sun <-> moon, sliding with a slight overshoot. */}
      <span
        className={`absolute left-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full shadow-md transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          isDark ? 'translate-x-7 bg-slate-200' : 'translate-x-0 bg-white'
        }`}
        aria-hidden="true"
      >
        <FontAwesomeIcon
          icon={faSun}
          className={`absolute h-3.5 w-3.5 text-slate-700 transition-all duration-500 ${
            isDark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
          }`}
        />
        <FontAwesomeIcon
          icon={faMoon}
          className={`absolute h-3 w-3 text-slate-600 transition-all duration-500 ${
            isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
          }`}
        />
      </span>
    </button>
  )
}
