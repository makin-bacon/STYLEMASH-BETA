interface SaveButtonProps {
  disabled: boolean
  isSaving: boolean
  onSave: () => void
  className?: string
}

/** Always-available save action. Downloads the (possibly edited) document
 * locally in its original format, filename suffixed with "-MASHED" - never
 * uploads anything anywhere, since StyleMash does all processing
 * client-side in the browser. Rendered in UserStylesPanel's footer, below
 * the Undo/"Mash it" row. Bright `green-400` - the same green as the
 * merge-progress fill in Current styles and the "BETA" tag - so it takes dark
 * (`text-chrome`) text rather than white, which would be unreadable on it. */
export function SaveButton({ disabled, isSaving, onSave, className = '' }: SaveButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || isSaving}
      onClick={onSave}
      className={`rounded-md bg-green-400 px-3 py-1.5 text-xs font-semibold text-chrome enabled:hover:bg-green-300 disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-fg ${className}`}
    >
      {isSaving ? 'Saving…' : 'Save your file'}
    </button>
  )
}
