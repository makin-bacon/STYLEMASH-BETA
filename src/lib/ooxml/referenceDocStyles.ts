import type { ParsedDocx, StyleEntity, UserStyleRecord } from '../../types/ooxml'
import {
  findSameNamedStyleId,
  mergeParagraphStyle,
  mergeStyles,
  removeStyleById,
  resolveUserStyleName,
} from './mergeStyles'
import { buildStylePreviewMarker, copyListDefinition, resolveStyleListFormat, resolveStyleNumPr } from './numbering'
import { countOccurrencesForStyleId } from './styleReport'
import { buildResolutionContext, buildStylesMap, getDocDefaultsRPr, resolveStyleRPr } from './styleResolution'
import { trackedChildrenToSignature } from './signature'
import { buildThemeColorMap, resolveColorElement } from './themeColor'

/** Materializes every paragraph/character style *defined* in Document B's
 * stylesXml - whether or not that style is actually applied anywhere in
 * Document B's own body text - as a real <w:style> in `targetDocx`
 * (Document A)'s stylesXml. Uses the existing mergeStyles()/
 * mergeParagraphStyle() "+ New Style" code paths (empty sourceRunRefs), so a
 * materialized style is byte-for-byte the same shape, and behaves
 * identically as a reuse target, as any manually-created UserStyleRecord.
 * Mutates targetDocx.stylesXml (and, for a list style, numberingXml) in
 * place; referenceDocx is read-only. Table/numbering-type style defs are
 * skipped - this app only ever merges run-level formatting plus list
 * numbering via a paragraph style, so neither is a meaningful target here.
 *
 * A Document B style that's itself a paragraph style carrying list
 * numbering (its own <w:pPr>/<w:numPr>, or one inherited through its
 * w:basedOn chain - e.g. a "List Bullet"-alike) is materialized as a
 * paragraph-kind record carrying a copy of Document B's own list definition
 * (copyListDefinition - so multilevel markers like "1.1" survive; a fresh
 * single-level list only if the copy fails) - so
 * it shows its list marker immediately, the same as a manually-created list
 * style, rather than only once it happens to pick up its first merged
 * occurrence. A paragraph style that explicitly turns numbering off
 * (numId="0", e.g. "Heading 2 No Numbering") is also materialized as a
 * paragraph-kind, list-less record, so merging into it strips numbers.
 * Every other Document B style (the common case) still
 * materializes as a character style, same as before: this app never tracks
 * paragraph-level properties besides list numbering, so a plain paragraph
 * style and a character style achieve the identical visible result for the
 * 7 attributes StyleMash actually merges.
 *
 * A style's materialized signature is its own fully-cascaded look (through
 * Document B's own basedOn chain to Document B's own docDefaults and theme)
 * - not any particular Style Report entity's signature, which is
 * paragraph-context-dependent for character styles (see resolveRunFormatting).
 *
 * `existingUserStyles` guards against duplicate-named entries piling up
 * across a "remove Document B, attach a different one" cycle (or even just
 * colliding with a manually-created style): when a Document B style's name
 * exactly matches an existing UserStyleRecord's, the newest file wins - its
 * definition is written into the *existing* style's styleId (via
 * reuseExistingStyleId) rather than creating a second, differently-IDed
 * style of the same name, so any content already merged into the old one
 * keeps pointing at it and simply adopts the new look. Returns the full,
 * ready-to-use replacement for `existingUserStyles` (collided entries
 * replaced in place, genuinely-new ones appended) - callers should assign
 * this directly rather than spreading it onto the old array. */
export function materializeReferenceDocStyles(
  targetDocx: ParsedDocx,
  referenceDocx: ParsedDocx,
  existingUserStyles: UserStyleRecord[],
): UserStyleRecord[] {
  const stylesMapB = buildStylesMap(referenceDocx.stylesXml)
  const themeColorsB = buildThemeColorMap(referenceDocx.themeXml)
  const ctxB = buildResolutionContext(stylesMapB, getDocDefaultsRPr(referenceDocx.stylesXml), themeColorsB)

  // Case-insensitive, matching how same-named document styles are found
  // (findSameNamedStyleId) - "heading 1" and "Heading 1" are one style to Word.
  const existingByName = new Map(existingUserStyles.map((r) => [r.name.toLowerCase(), r]))
  // Keyed by the *old* (reused) styleId, since mergeStyles()/
  // mergeParagraphStyle() always returns exactly that id back when
  // reuseExistingStyleId is passed.
  const replacements = new Map<string, UserStyleRecord>()
  const brandNew: UserStyleRecord[] = []
  // Document B numId -> the numId of its copy in Document A (null: couldn't copy).
  const copiedLists = new Map<string, string | null>()

  // Map insertion order == styles.xml document order (see buildStylesMap),
  // so genuinely-new records land in Document B's own style-definition
  // order in the User-Created Styles panel.
  for (const bStyle of stylesMapB.values()) {
    if (bStyle.type !== 'paragraph' && bStyle.type !== 'character') continue
    const bStyleId = bStyle.id

    const tracked = resolveStyleRPr(bStyleId, ctxB.stylesMap, ctxB.docDefaultsTracked, ctxB.styleRPrCache)
    const signature = trackedChildrenToSignature(tracked, (colorEl) =>
      resolveColorElement(colorEl, themeColorsB),
    )

    const listFormat =
      bStyle.type === 'paragraph'
        ? resolveStyleListFormat(bStyleId, stylesMapB, referenceDocx.numberingXml)
        : 'none'
    const listPreviewText =
      listFormat === 'none'
        ? undefined
        : buildStylePreviewMarker(bStyleId, stylesMapB, referenceDocx.numberingXml)
    const bNumPr = bStyle.type === 'paragraph' ? resolveStyleNumPr(bStyleId, stylesMapB) : null
    // Any paragraph style that takes a position on numbering stays a
    // paragraph style - including one that explicitly switches it off
    // (numId="0", e.g. "Heading 2 No Numbering"), so merging a numbered
    // paragraph into it actually removes the numbers.
    const kind = bNumPr !== null ? 'paragraph' : 'character'

    // Carry Document B's real list definition across (once per B list, so
    // styles that share a list in B - heading 1..9 - share one in A too),
    // keeping multilevel numbering like "1.1" intact.
    let listNumPr: { numId: string; ilvl: number } | undefined
    if (listFormat !== 'none' && bNumPr && bNumPr !== 'off') {
      let aNumId = copiedLists.get(bNumPr.numId)
      if (aNumId === undefined) {
        aNumId = copyListDefinition(targetDocx, referenceDocx.numberingXml, bNumPr.numId)
        copiedLists.set(bNumPr.numId, aNumId)
      }
      if (aNumId !== null) listNumPr = { numId: aNumId, ilvl: bNumPr.ilvl }
    }

    const name = resolveUserStyleName(targetDocx.stylesXml, bStyle.name, kind)
    const collision = existingByName.get(name.toLowerCase())
    const adopted = !collision && findSameNamedStyleId(targetDocx.stylesXml, name, kind) !== null
    const newStyleId =
      kind === 'character'
        ? mergeStyles(targetDocx, [], signature, name, collision?.styleId)
        : mergeParagraphStyle(
            targetDocx,
            [],
            signature,
            name,
            listFormat,
            collision?.styleId,
            listNumPr,
          )

    const record: UserStyleRecord = {
      styleId: newStyleId,
      name,
      targetSignature: signature,
      kind,
      listFormat,
      listPreviewText,
      createdAt: collision?.createdAt ?? Date.now(),
      fromReferenceDoc: true,
      ...(adopted || collision?.adoptedFromDocument ? { adoptedFromDocument: true as const } : {}),
    }

    if (collision) {
      replacements.set(collision.styleId, record)
    } else {
      brandNew.push(record)
    }
  }

  const merged = existingUserStyles.map((r) => replacements.get(r.styleId) ?? r)
  return [...merged, ...brandNew]
}

/** The other half of the "remove Document B" lifecycle: for every
 * `fromReferenceDoc` record, keeps it (stripped of the flag) if it's
 * actually in use, or fully removes it (record + <w:style> definition) if
 * it never got merged into - a complete undo. countOccurrencesForStyleId
 * matches both w:rStyle and w:pStyle usage (see styleReport.ts), so it's a
 * complete usage count regardless of whether a given materialized style
 * ended up character- or paragraph-kind (see materializeReferenceDocStyles).
 * Pure - the caller is expected to bump its own `parsedDocx` wrapper since
 * `stylesXml` is mutated in place. */
export function reconcileUserStylesOnReferenceDocRemoval(
  userStyles: UserStyleRecord[],
  styleReport: StyleEntity[],
  stylesXml: XMLDocument,
): UserStyleRecord[] {
  const kept: UserStyleRecord[] = []
  for (const record of userStyles) {
    if (!record.fromReferenceDoc) {
      kept.push(record)
      continue
    }
    const occurrences = countOccurrencesForStyleId(styleReport, record.styleId)
    if (occurrences > 0) {
      const { fromReferenceDoc: _drop, ...rest } = record
      kept.push(rest)
    } else {
      // A style adopted from the document itself is the document's own -
      // only the record goes.
      if (!record.adoptedFromDocument) removeStyleById(stylesXml, record.styleId)
      // record dropped entirely
    }
  }
  return kept
}
