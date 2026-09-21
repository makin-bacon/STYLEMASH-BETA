import { useEffect, useRef } from 'react'
import type { StyleEntity, StyleEntityVariant } from '../types/ooxml'
import type { ParagraphMarker } from '../lib/ooxml/numbering'
import { signatureToCss } from '../lib/signatureToCss'
import { describeSignature } from '../lib/styleDescriptions'
import { InfoTooltip } from './InfoTooltip'
import { StyleVariantRow } from './StyleVariantRow'

/** A variant's list marker is taken from its first occurrence's paragraph -
 * the same paragraph that produced `variant.sampleText` (see
 * styleReport.ts#buildStyleReport: the run that sets sampleText is always
 * runRefs[0], since empty-text runs are skipped before either is touched).
 * So the marker shown always matches the sample text it's prefixed to. */
function markerFor(variant: StyleEntityVariant, paragraphMarkers: Map<Element, ParagraphMarker>) {
  const paragraphEl = variant.runRefs[0]?.paragraphElement
  return paragraphEl ? paragraphMarkers.get(paragraphEl) : undefined
}

interface StyleReportPanelProps {
  styleReport: StyleEntity[]
  selectedIds: Set<string>
  /** Resolved list marker per paragraph, shared with DocumentPreviewPanel -
   * lets a numbered/bulleted entry's sample text keep looking like a list
   * item here instead of a plain paragraph. */
  paragraphMarkers: Map<Element, ParagraphMarker>
  onToggleSelect: (variantId: string) => void
  /** True once at least one style has been imported from Document B - the
   * bulk-match controls below are hidden entirely otherwise. */
  hasReferenceStyles: boolean
  bulkMergeError: string | null
  onSelectMatchingReferenceStyles: () => void
  onBulkMergeMatched: () => void
  /** How many Style Report entries are already merged into a User-Created
   * style vs. still outstanding - see styleReport.ts#computeMergeProgress. */
  mergeProgress: { total: number; merged: number; remaining: number }
  /** Backs the inline "Save your work" link shown once every entry is
   * matched (the same action as the "Save your file" button, which now lives
   * at the bottom of the New Styles panel - this link just offers it again
   * right where the now-empty-looking list used to be). */
  onSave: () => void
  /** Drives this panel's own "Mash a different file" header button, plus
   * the equivalent link in the empty state below. */
  onRipAnotherFile: () => void
}

/** Left-hand panel: every distinct text style/appearance found in the
 * uploaded document, most common first. An entry with only one variant
 * renders as a single flat row; an entry that mixes e.g. style-derived text
 * with direct-override text of the same look (or list text that merely
 * happens to share formatting with non-list text - very common when a
 * document's lists use manual/direct formatting rather than a named style)
 * gets a shared header plus one selectable sub-row per variant, so they can
 * be merged independently rather than being silently lumped together. */
export function StyleReportPanel({
  styleReport,
  selectedIds,
  paragraphMarkers,
  onToggleSelect,
  hasReferenceStyles,
  bulkMergeError,
  onSelectMatchingReferenceStyles,
  onBulkMergeMatched,
  mergeProgress,
  onSave,
  onRipAnotherFile,
}: StyleReportPanelProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const prevSelectedIdsRef = useRef<Set<string>>(new Set())

  // A selection made in the Document Preview (click a run) may pick a row
  // that's scrolled out of view here - bring the first newly-selected row
  // into view. `nearest` makes it a no-op for a row the user just clicked
  // in this list themselves, which is already visible.
  useEffect(() => {
    const prev = prevSelectedIdsRef.current
    prevSelectedIdsRef.current = selectedIds
    const newlyAdded = [...selectedIds].filter((id) => !prev.has(id))
    if (newlyAdded.length === 0) return
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-variant-id]') ?? []
    for (const row of rows) {
      if (row.dataset.variantId === newlyAdded[0]) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        return
      }
    }
  }, [selectedIds])

  const percentMerged =
    mergeProgress.total === 0 ? 100 : Math.round((mergeProgress.merged / mergeProgress.total) * 100)
  const allMatched = mergeProgress.total > 0 && mergeProgress.remaining === 0
  return (
    <div data-tour="current-styles" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex min-h-15 items-start justify-between gap-2 border-b border-line bg-chrome-mid px-4 py-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-chrome-fg">
          Current styles <span className="font-normal text-chrome-muted">({styleReport.length})</span>
          <InfoTooltip text="Select items from this list and you'll see them in your document. Now either merge these with a newly created style or one from an uploaded reference Word file in the &quot;New&quot; styles list." />
        </h2>
        <button
          type="button"
          onClick={onRipAnotherFile}
          className="shrink-0 rounded-md border border-accent-line px-2 py-1 text-xs font-medium text-chrome-fg hover:bg-chrome-hover-2"
        >
          Mash a different file
        </button>
      </div>

      <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {allMatched ? (
          <li className="flex h-full items-center justify-center px-4 py-6 text-center text-sm text-ink-5">
            <p>
              <button
                type="button"
                onClick={onSave}
                className="text-xs font-medium text-accent hover:text-accent-3 hover:underline"
              >
                Save your work
              </button>{' '}
              <br />or{' '}
              <button
                type="button"
                onClick={onRipAnotherFile}
                className="text-xs font-medium text-accent hover:text-accent-3 hover:underline"
              >
                mash another file
              </button>
            </p>
          </li>
        ) : (
          <>
            {styleReport.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-ink-5">
                No formatted text found in this document.
              </li>
            )}
            {styleReport.map((entity) =>
              entity.variants.length === 1 ? (
                <StyleVariantRow
                  key={entity.variants[0].id}
                  signature={entity.signature}
                  variant={entity.variants[0]}
                  listMarker={markerFor(entity.variants[0], paragraphMarkers)}
                  selected={selectedIds.has(entity.variants[0].id)}
                  onToggleSelect={() => onToggleSelect(entity.variants[0].id)}
                />
              ) : (
                <li key={entity.id} className="border-b border-line last:border-b-0">
                  <div className="bg-soft px-4 py-1.5">
                    <p className="truncate text-sm" style={signatureToCss(entity.signature)}>
                      {/* Marker and text both come from variants[0] (the most common
                          variant) rather than entity.sampleText - keeping them from the
                          same occurrence so the marker shown always matches the text
                          it's prefixed to (entity.sampleText is just "whichever text
                          appeared first in the document" across every variant, which
                          since list vs. non-list is its own variant dimension could
                          easily belong to a different variant than variants[0]). */}
                      {markerFor(entity.variants[0], paragraphMarkers)?.text && (
                        <span className="mr-1 text-ink-5">
                          {markerFor(entity.variants[0], paragraphMarkers)?.text}
                        </span>
                      )}
                      {entity.variants[0].sampleText || '(no visible text)'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-4">
                      {describeSignature(entity.signature)} · {entity.occurrenceCount} total across{' '}
                      {entity.variants.length} sources
                    </p>
                  </div>
                  <ul>
                    {entity.variants.map((variant) => (
                      <StyleVariantRow
                        key={variant.id}
                        signature={entity.signature}
                        variant={variant}
                        listMarker={markerFor(variant, paragraphMarkers)}
                        indented
                        selected={selectedIds.has(variant.id)}
                        onToggleSelect={() => onToggleSelect(variant.id)}
                      />
                    ))}
                  </ul>
                </li>
              ),
            )}
          </>
        )}
      </ul>

      {/* Bulk-match panel disabled for now - needs more work and was adding
          stray padding under the page footer. Re-enable by restoring the
          `hasReferenceStyles &&` condition below. */}
      {false && hasReferenceStyles && (
        <div className="border-t border-line bg-accent-bg/50 px-4 py-2">
          <label className="flex items-center gap-2 text-xs text-ink-3">
            <input
              type="checkbox"
              onChange={(e) => {
                if (e.target.checked) onSelectMatchingReferenceStyles()
              }}
              className="accent-violet-600"
            />
            Select styles matching Document B
          </label>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={onBulkMergeMatched}
            className="mt-1.5 w-full rounded-md border border-accent-line bg-surface px-3 py-1.5 text-xs font-medium text-accent-2 enabled:hover:bg-accent-bg-2 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-5"
          >
            Merge matched styles into Document B
          </button>
          {bulkMergeError && <p className="mt-1 text-xs text-danger">{bulkMergeError}</p>}
        </div>
      )}

      <div className="border-t border-line px-4 py-2">
        <div className="py-2">
          <div className="flex items-center justify-between text-xs text-ink-4">
            <span>
              {mergeProgress.merged} of {mergeProgress.total} merged into a User-Created style
            </span>
            <span>{mergeProgress.remaining} left</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-track">
            <div
              className="h-full rounded-full bg-violet-500 transition-[width]"
              style={{ width: `${percentMerged}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
