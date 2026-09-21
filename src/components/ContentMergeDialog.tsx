import { useState } from 'react'

interface ContentMergeDialogProps {
  sourceFilename: string
  referenceFilename: string
  isMerging: boolean
  error: string | null
  onConfirm: (keepOriginalFormatting: boolean) => void
  onCancel: () => void
}

/** Confirmation modal for the "merge content into Document B" action -
 * mirrors MergeDialog/XmlEditorModal's shell. Its one meaningful choice is
 * the global toggle for how content left over in Document A (never
 * explicitly merged into a Document B-sourced style) is handled. */
export function ContentMergeDialog({
  sourceFilename,
  referenceFilename,
  isMerging,
  error,
  onConfirm,
  onCancel,
}: ContentMergeDialogProps) {
  const [keepOriginalFormatting, setKeepOriginalFormatting] = useState(true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onConfirm(keepOriginalFormatting)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-ink">Merge content into Document B</h2>
        <p className="mt-1 text-xs text-ink-4">
          Replaces <span className="font-medium">{referenceFilename}</span>&rsquo;s text content with{' '}
          <span className="font-medium">{sourceFilename}</span>&rsquo;s. Document B&rsquo;s page setup
          (margins, headers, footers, section properties) is never changed.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-sm text-ink-3">
              For text not explicitly merged into a Document B style:
            </legend>
            <label className="flex items-start gap-2 text-sm text-ink-2">
              <input
                type="radio"
                name="keepOriginalFormatting"
                checked={keepOriginalFormatting}
                onChange={() => setKeepOriginalFormatting(true)}
                className="mt-0.5 accent-indigo-600"
              />
              <span>
                Keep original formatting
                <span className="block text-xs text-ink-5">Leftover text keeps looking as it did in the source document.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink-2">
              <input
                type="radio"
                name="keepOriginalFormatting"
                checked={!keepOriginalFormatting}
                onChange={() => setKeepOriginalFormatting(false)}
                className="mt-0.5 accent-indigo-600"
              />
              <span>
                Snap to Document B&rsquo;s style of the same name, where one exists
                <span className="block text-xs text-ink-5">
                  Leftover text under a named style also present in Document B adopts Document B&rsquo;s
                  version of it.
                </span>
              </span>
            </label>
          </fieldset>

          <p className="rounded-md border border-warn-line bg-warn px-3 py-2 text-xs text-warn-ink">
            Hyperlinks, images, and numbered/bulleted list formatting aren&rsquo;t reconciled across
            documents and may not carry over correctly.
          </p>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isMerging}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-3 hover:bg-soft-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isMerging}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white enabled:hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-fg"
            >
              {isMerging ? 'Merging…' : 'Merge & download'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
