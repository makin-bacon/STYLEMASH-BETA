import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronRight } from '@fortawesome/free-solid-svg-icons'
import type { ReferenceDocState } from '../hooks/useDocxWorkspace'
import type { StyleEntity, UserStyleRecord } from '../types/ooxml'
import type { ParagraphMarker } from '../lib/ooxml/numbering'
import { countOccurrencesForStyleId } from '../lib/ooxml/styleReport'
import { signatureToCss } from '../lib/signatureToCss'
import { USER_STYLE_CATEGORIES, groupUserStylesByCategory, type UserStyleCategory } from '../lib/userStyleCategories'
import { AttachReferenceDocButton } from './AttachReferenceDocButton'
import { DefaultStylesChecklist } from './DefaultStylesChecklist'
import { FaCheckbox } from './FaCheckbox'
import { InfoTooltip } from './InfoTooltip'

/** Finds a representative list marker for a User-Created style, the same
 * way StyleReportPanel does for a Style Report variant - looked up by
 * styleId (rather than taking a variant directly) since a UserStyleRecord
 * doesn't have one, just the styleId every variant it controls shares.
 * Matches both character (w:rStyle) and paragraph (w:pStyle) origins, since
 * a UserStyleRecord can be either kind. Returns the first matching variant's
 * marker, so a style that's been merged from list-item occurrences keeps
 * showing that it's a list style here too, not just in the Style
 * Report/preview. */
function markerForStyleId(
  styleReport: StyleEntity[],
  styleId: string,
  paragraphMarkers: Map<Element, ParagraphMarker>,
): ParagraphMarker | undefined {
  for (const entity of styleReport) {
    for (const variant of entity.variants) {
      if (
        (variant.origin.kind !== 'named-character' && variant.origin.kind !== 'named-paragraph') ||
        variant.origin.styleId !== styleId
      ) {
        continue
      }
      const paragraphEl = variant.runRefs[0]?.paragraphElement
      const marker = paragraphEl && paragraphMarkers.get(paragraphEl)
      if (marker) return marker
    }
  }
  return undefined
}

/** One User-Created style row - the exact markup UserStylesPanel's list used
 * to render inline, pulled out so it can be rendered under a category
 * section instead of a flat list. Behavior unchanged: clicking anywhere but
 * "Edit" picks this record as the merge target. */
function UserStyleRow({
  record,
  styleReport,
  paragraphMarkers,
  onEditStyle,
  selectedTargetStyleId,
  onToggleSelectTarget,
  pendingSelectionCount,
  onMergeSelectedIntoTarget,
  mergeError,
}: {
  record: UserStyleRecord
  styleReport: StyleEntity[]
  paragraphMarkers: Map<Element, ParagraphMarker>
  onEditStyle: (styleId: string) => void
  selectedTargetStyleId: string | null
  onToggleSelectTarget: (styleId: string) => void
  pendingSelectionCount: number
  onMergeSelectedIntoTarget: () => void
  mergeError: string | null
}) {
  const occurrences = countOccurrencesForStyleId(styleReport, record.styleId)
  const markerText = markerForStyleId(styleReport, record.styleId, paragraphMarkers)?.text || record.listPreviewText
  const isTarget = selectedTargetStyleId === record.styleId
  return (
    <li
      onClick={() => onToggleSelectTarget(record.styleId)}
      className={`flex cursor-pointer items-start gap-3 border-b border-l-4 border-line px-4 py-3 transition-colors last:border-b-0 ${
        isTarget
          ? // Deliberately a different accent (amber, not the Current
            // Styles list's indigo) - loud on purpose, as a stopgap so
            // "selected here" and "selected over there" read as
            // visually distinct lists rather than one shared
            // selection. Revisit with a more considered color later.
            'border-l-target-edge bg-target hover:bg-target-hover active:bg-target-active'
          : 'border-l-transparent hover:border-l-target-edge-hover hover:bg-soft active:bg-soft-2'
      }`}
    >
      <FaCheckbox
        checked={isTarget}
        onToggle={() => onToggleSelectTarget(record.styleId)}
        label={`Select "${record.name}" as the merge target`}
        className="mt-0.5"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium" style={signatureToCss(record.targetSignature)}>
          {markerText && <span className="mr-1 text-ink-5">{markerText}</span>}
          {record.name}
        </p>
        <p className="mt-1 truncate text-xs text-ink-5">styleId: {record.styleId}</p>
        {isTarget && pendingSelectionCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onMergeSelectedIntoTarget()
            }}
            className="mt-2 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Merge {pendingSelectionCount} selected here
          </button>
        )}
        {isTarget && mergeError && <p className="mt-1 text-xs text-danger">{mergeError}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {record.fromReferenceDoc && (
          <span className="rounded-full bg-accent-bg px-2 py-0.5 text-xs font-medium text-accent">
            from Document B
          </span>
        )}
        {record.kind === 'paragraph' && (
          <span className="rounded-full bg-tag-purple-bg px-2 py-0.5 text-xs font-medium text-tag-purple">
            {record.listFormat === 'bullet'
              ? 'Bulleted list'
              : record.listFormat === 'decimal'
                ? 'Numbered list'
                : 'Paragraph style'}
          </span>
        )}
        <span className="rounded-full bg-soft-2 px-2 py-0.5 text-xs font-medium text-ink-3">
          {occurrences}×
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEditStyle(record.styleId)
          }}
          className="text-xs font-medium text-accent hover:text-accent-3 hover:underline"
        >
          Edit
        </button>
      </div>
    </li>
  )
}

/** One collapsible category section (Body/Miscellaneous, Headings, Lists) -
 * the same 0fr/1fr grid-template-rows expand animation and chevron
 * DefaultStylesChecklist's own CategorySection uses, so grouping reads as
 * one consistent convention across both panels. Defaults open (unlike the
 * Customise checklist's sections, which default closed): this is the user's
 * actual working list of styles, not a rarely-opened settings panel, so
 * hiding its contents by default would read as styles having disappeared. */
function UserStyleCategorySection({
  category,
  records,
  ...rowProps
}: {
  category: UserStyleCategory
  records: UserStyleRecord[]
} & Omit<Parameters<typeof UserStyleRow>[0], 'record'>) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 bg-soft px-4 py-2 text-left text-xs font-semibold text-ink-3 hover:bg-soft-2"
      >
        <span className="flex items-center gap-1.5">
          <FontAwesomeIcon
            icon={faChevronRight}
            aria-hidden="true"
            className={`text-[10px] text-ink-5 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
          />
          {category}
        </span>
        <span className="text-[11px] font-normal text-ink-5">{records.length}</span>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <ul>
            {records.map((record) => (
              <UserStyleRow key={record.styleId} record={record} {...rowProps} />
            ))}
          </ul>
        </div>
      </div>
    </li>
  )
}

interface UserStylesPanelProps {
  userStyles: UserStyleRecord[]
  styleReport: StyleEntity[]
  /** Resolved list marker per paragraph, shared with StyleReportPanel and
   * DocumentPreviewPanel - see markerForStyleId above. */
  paragraphMarkers: Map<Element, ParagraphMarker>
  onEditStyle: (styleId: string) => void
  onCreateNewStyle: () => void
  /** Populates the list with StyleMash's bundled starter style set (see
   * defaultStyles.ts) - a name collision with an existing style redefines
   * its look rather than duplicating it. User-initiated only; never runs
   * automatically. */
  onAddDefaultStyles: () => void
  /** The single style currently picked as a merge target (row click, not
   * "Edit") - null when none is. */
  selectedTargetStyleId: string | null
  onToggleSelectTarget: (styleId: string) => void
  /** Count of Style Report entries currently selected on the other panel -
   * drives the inline "Merge N selected here" action on the target row. */
  pendingSelectionCount: number
  onMergeSelectedIntoTarget: () => void
  /** Surfaced here (not just in MergeDialog) since MERGE_SELECTED_INTO_TARGET
   * has no dialog of its own to show it in. */
  mergeError: string | null
  /** Drives the footer's "Attach custom Word styles" button while nothing's
   * attached, and its "Remove Document B" button once one is - same footer
   * slot either way, just swapping which button occupies it. */
  referenceDoc: ReferenceDocState
  onAttachReferenceDoc: (file: File) => void
  onRemoveReferenceDoc: () => void
  /** Wipes every User-Created style (record + <w:style> definition) in one
   * go. Pushes its own undo snapshot (see useDocxWorkspace), so an accidental
   * click is recoverable via the Undo button. */
  onClearUserStyles: () => void
  /** Whether AppHeader's "Customise your own style file" button has this
   * panel's DefaultStylesChecklist expanded - see that component's own doc
   * comment for why it lives here rather than in a separate modal. */
  isCustomizeOpen: boolean
  enabledDefaultStyleNames: Set<string>
  onToggleDefaultStyleEnabled: (name: string) => void
}

/** Right-hand panel: the named styles StyleMash has created via merges
 * this session. Occurrence counts are always re-derived from the latest
 * Style Report (via countOccurrencesForStyleId) rather than hand-maintained,
 * so they can never drift out of sync with the actual document state.
 * "+ New Style" defines a style from scratch (0 occurrences until you merge
 * Style Report entries into it later via Edit, or target it directly from
 * the merge dialog when merging a fresh selection).
 *
 * Clicking a row (anywhere but "Edit") picks it as a merge target rather
 * than opening the edit dialog - the same "click to select" pattern as the
 * Style Report's rows, so selecting entries there and a target here is a
 * direct two-list gesture that ends with "Merge N selected here", no dialog
 * detour needed. "Edit" is still how you redefine a style's own look. */
export function UserStylesPanel({
  userStyles,
  styleReport,
  paragraphMarkers,
  onEditStyle,
  onCreateNewStyle,
  onAddDefaultStyles,
  selectedTargetStyleId,
  onToggleSelectTarget,
  pendingSelectionCount,
  onMergeSelectedIntoTarget,
  mergeError,
  referenceDoc,
  onAttachReferenceDoc,
  onRemoveReferenceDoc,
  onClearUserStyles,
  isCustomizeOpen,
  enabledDefaultStyleNames,
  onToggleDefaultStyleEnabled,
}: UserStylesPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex min-h-15 items-start justify-between gap-2 border-b border-line bg-chrome px-4 py-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-chrome-fg">
            New Styles <span className="font-normal text-chrome-muted">({userStyles.length})</span>
            <InfoTooltip text="Select entries in the Old Styles list, then click a style here to merge them. To generate styles, hit the &quot;+ New Style&quot; button, upload a reference document or you can auto populate the list with some sensible styles to get you started." />
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onAddDefaultStyles}
            className="rounded-md bg-orange-600 px-2 py-1 text-xs font-medium text-white hover:bg-orange-700"
          >
            + Defaults
          </button>
          <button
            type="button"
            onClick={onCreateNewStyle}
            className="rounded-md border border-accent-line px-2 py-1 text-xs font-medium text-chrome-fg hover:bg-chrome-hover-2"
          >
            + New Style
          </button>
        </div>
      </div>

      {/* AppHeader's "Customise your own style file" button toggles this -
          same 0fr/1fr grid-template-rows animation DefaultStylesChecklist's
          own category sections use, so the whole panel doesn't just snap
          open. `shrink-0` keeps the styles list below from being squeezed
          as this expands rather than both fighting over the same flex
          space. */}
      <div
        className={`grid shrink-0 border-b border-line bg-soft transition-[grid-template-rows] duration-300 ease-in-out ${
          isCustomizeOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-4 py-3">
            <DefaultStylesChecklist
              enabledNames={enabledDefaultStyleNames}
              onToggle={onToggleDefaultStyleEnabled}
            />
          </div>
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {userStyles.length === 0 && (
          <li className="flex h-full items-center justify-center px-4 py-6 text-center text-sm text-ink-5">
            <p className="w-3/4">
              Select entries in Current styles and click "Mash it", or click "+ New Style"
              to define one from scratch.
            </p>
          </li>
        )}
        {userStyles.length > 0 &&
          (() => {
            const groups = groupUserStylesByCategory(userStyles)
            return USER_STYLE_CATEGORIES.filter((category) => (groups.get(category)?.length ?? 0) > 0).map(
              (category) => (
                <UserStyleCategorySection
                  key={category}
                  category={category}
                  records={groups.get(category) ?? []}
                  styleReport={styleReport}
                  paragraphMarkers={paragraphMarkers}
                  onEditStyle={onEditStyle}
                  selectedTargetStyleId={selectedTargetStyleId}
                  onToggleSelectTarget={onToggleSelectTarget}
                  pendingSelectionCount={pendingSelectionCount}
                  onMergeSelectedIntoTarget={onMergeSelectedIntoTarget}
                  mergeError={mergeError}
                />
              ),
            )
          })()}
      </ul>

      {/* Always rendered (never conditionally mounted) so this row's height
          never changes as Document B is attached/removed - same reasoning
          as DocumentPreviewPanel's own footer row. "Clear list" always
          occupies the left half; the right half still swaps between
          Attach/Remove Document B depending on referenceDoc.status. */}
      <div className="flex gap-2 border-t border-line px-4 py-2">
        <button
          type="button"
          disabled={userStyles.length === 0}
          onClick={onClearUserStyles}
          className="flex-1 rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-3 enabled:hover:bg-soft disabled:cursor-not-allowed disabled:text-ink-6"
        >
          Clear list
        </button>
        <div className="flex-1">
          {referenceDoc.status === 'loaded' ? (
            <button
              type="button"
              onClick={onRemoveReferenceDoc}
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-3 hover:bg-soft"
            >
              Remove Document B
            </button>
          ) : (
            <AttachReferenceDocButton
              status={referenceDoc.status}
              errorMessage={referenceDoc.errorMessage}
              onAttach={onAttachReferenceDoc}
            />
          )}
        </div>
      </div>
    </div>
  )
}
