import type { FormattingSignature, ListFormat, ParsedDocx, RunRef } from '../../types/ooxml'
import { NS } from './constants'
import { createWEl, insertRPrChildInOrder, removeWChild, setWAttr, wAttr, wChild, wChildren } from './domUtils'
import { createListNumId, readStyleElementNumPr, resolveListLevelFormat, type StyleNumPr } from './numbering'
import { stripTrackedProps, writeSignatureIntoRPr } from './rPrHelpers'

function collectExistingStyleIds(stylesXml: XMLDocument): Set<string> {
  const ids = new Set<string>()
  const stylesRoot = stylesXml.getElementsByTagNameNS(NS.w, 'styles')[0]
  if (!stylesRoot) return ids
  for (const styleEl of wChildren(stylesRoot, 'style')) {
    const id = wAttr(styleEl, 'styleId')
    if (id) ids.add(id)
  }
  return ids
}

/** The styleId of a style this document already has with the same name
 * (case-insensitive, as Word compares built-in names like "heading 1") and
 * the same type - or null. Word folds same-name, same-type styles into one
 * when it opens a file, so a new lookalike style would silently redefine the
 * document's own (e.g. every untouched Heading 3 paragraph picking up the
 * new look and numbering) while StyleMash's preview showed them unchanged.
 * Creating a style therefore redefines this one instead - see mergeStyles()
 * and mergeParagraphStyle(). */
export function findSameNamedStyleId(
  stylesXml: XMLDocument,
  name: string,
  type: 'paragraph' | 'character',
): string | null {
  const stylesRoot = stylesXml.getElementsByTagNameNS(NS.w, 'styles')[0]
  if (!stylesRoot) return null
  const wanted = name.trim().toLowerCase()
  for (const styleEl of wChildren(stylesRoot, 'style')) {
    if (wAttr(styleEl, 'type') !== type) continue
    const styleName = wAttr(wChild(styleEl, 'name'), 'val')
    if (styleName?.trim().toLowerCase() === wanted) return wAttr(styleEl, 'styleId')
  }
  return null
}

/** Suffix for a StyleMash style whose name or id would otherwise clash with
 * one of the document's own - "Normal_User" rather than Word's "Normal1" -
 * so it's obvious in Word's style list which one StyleMash made. */
export const USER_STYLE_SUFFIX = '_User'

/** `name` with its spaces turned into underscores and "_User" appended
 * ("Normal Bold" -> "Normal_Bold_User"), or "_User_2", "_User_3", ... for
 * `n` >= 2. */
function userSuffixed(name: string, n: number): string {
  const base = `${name.trim().replace(/\s+/g, '_')}${USER_STYLE_SUFFIX}`
  return n < 2 ? base : `${base}_${n}`
}

/** The name StyleMash should actually give a new/redefined style: `name`
 * itself, unless the document already has a style of a *different* type
 * with that name (e.g. the bundled character style "Normal" next to Word's
 * paragraph style "Normal"). Word won't keep two such styles under one name
 * - it renames ours "Normal1" on open - so it becomes "Normal_User" (then
 * "Normal_User_2", ...) instead; "Normal Bold" becomes "Normal_Bold_User".
 * A *same*-type clash isn't renamed: that style is adopted
 * (findSameNamedStyleId). Idempotent - resolving a name this already
 * returned gives it back unchanged. */
export function resolveUserStyleName(
  stylesXml: XMLDocument,
  name: string,
  type: 'paragraph' | 'character',
): string {
  const stylesRoot = stylesXml.getElementsByTagNameNS(NS.w, 'styles')[0]
  if (!stylesRoot) return name
  const otherTypeNames = new Set<string>()
  for (const styleEl of wChildren(stylesRoot, 'style')) {
    if (wAttr(styleEl, 'type') === type) continue
    const styleName = wAttr(wChild(styleEl, 'name'), 'val')
    if (styleName) otherTypeNames.add(styleName.trim().toLowerCase())
  }
  const clashes = (candidate: string) => otherTypeNames.has(candidate.trim().toLowerCase())
  if (!clashes(name)) return name
  let n = 1
  while (clashes(userSuffixed(name, n))) n = n < 2 ? 2 : n + 1
  return userSuffixed(name, n)
}

function slugify(name: string): string {
  // Underscores survive, so "Normal_Bold_User" keeps the same id as its name.
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '')
  const base = cleaned.length > 0 ? cleaned : 'Style'
  return /^[0-9]/.test(base) ? `Style${base}` : base
}

/** Generates a styleId guaranteed not to collide with any existing
 * @w:styleId in this document, by slugifying `name` and appending "_User",
 * then "_User_2", "_User_3"... on collision (see USER_STYLE_SUFFIX). */
export function generateUniqueStyleId(stylesXml: XMLDocument, name: string): string {
  // Compared case-insensitively: "heading1" next to an existing "Heading1"
  // is asking for trouble in consumers that fold case.
  const existing = new Set([...collectExistingStyleIds(stylesXml)].map((id) => id.toLowerCase()))
  const base = slugify(name)
  if (!existing.has(base.toLowerCase())) return base
  let n = 1
  while (existing.has(userSuffixed(base, n).toLowerCase())) n = n < 2 ? 2 : n + 1
  return userSuffixed(base, n)
}

export function findStyleElementById(stylesRoot: Element, styleId: string): Element | null {
  for (const styleEl of wChildren(stylesRoot, 'style')) {
    if (wAttr(styleEl, 'styleId') === styleId) return styleEl
  }
  return null
}

/** Removes a <w:style> by id, if present. Used by the "remove Document B"
 * cleanup (see referenceDocStyles.ts) to fully undo a materialized style
 * that was never actually merged into. Returns whether it removed one. */
export function removeStyleById(stylesXml: XMLDocument, styleId: string): boolean {
  const stylesRoot = stylesXml.getElementsByTagNameNS(NS.w, 'styles')[0]
  const el = stylesRoot ? findStyleElementById(stylesRoot, styleId) : null
  if (!el || !stylesRoot) return false
  stylesRoot.removeChild(el)
  return true
}

/** Builds a new character-type <w:style>. CT_Style's schema order for the
 * children we use is name, basedOn, rPr - since this element's shape is
 * entirely under our control we hardcode that order directly rather than
 * going through the general rPr-child-ordering helper (that helper only
 * concerns itself with CT_RPr's children). */
function buildStyleElement(
  doc: XMLDocument,
  styleId: string,
  name: string,
  targetProps: FormattingSignature,
  hasDefaultParagraphFont: boolean,
): Element {
  const styleEl = createWEl(doc, 'style')
  setWAttr(styleEl, 'type', 'character')
  setWAttr(styleEl, 'styleId', styleId)

  const nameEl = createWEl(doc, 'name')
  setWAttr(nameEl, 'val', name)
  styleEl.appendChild(nameEl)

  if (hasDefaultParagraphFont) {
    const basedOnEl = createWEl(doc, 'basedOn')
    setWAttr(basedOnEl, 'val', 'DefaultParagraphFont')
    styleEl.appendChild(basedOnEl)
  }

  const rPr = createWEl(doc, 'rPr')
  writeSignatureIntoRPr(rPr, targetProps)
  styleEl.appendChild(rPr)

  return styleEl
}

function updateStyleNameAndRPr(
  styleEl: Element,
  name: string,
  targetProps: FormattingSignature,
): void {
  let nameEl = wChild(styleEl, 'name')
  if (!nameEl) {
    nameEl = createWEl(styleEl.ownerDocument, 'name')
    styleEl.insertBefore(nameEl, styleEl.firstChild)
  }
  setWAttr(nameEl, 'val', name)

  let rPr = wChild(styleEl, 'rPr')
  if (!rPr) {
    rPr = createWEl(styleEl.ownerDocument, 'rPr')
    styleEl.appendChild(rPr)
  }
  writeSignatureIntoRPr(rPr, targetProps)
}

function ensureRPrFirstChild(runEl: Element): Element {
  let rPr = wChild(runEl, 'rPr')
  if (!rPr) {
    rPr = createWEl(runEl.ownerDocument, 'rPr')
    runEl.insertBefore(rPr, runEl.firstChild)
  }
  return rPr
}

/** Points a run at `styleId` and strips the tracked-property children that
 * the style now supplies, per the merge's subsumption rule: everything the
 * app tracks (font/size/color/b/i/u/strike) is fully taken over by the
 * style; anything else on the run's rPr (vertAlign, spacing, lang, ...) is
 * left untouched. */
function applyStyleToRun(runEl: Element, styleId: string): void {
  const rPr = ensureRPrFirstChild(runEl)
  const rStyleEl = createWEl(runEl.ownerDocument, 'rStyle')
  setWAttr(rStyleEl, 'val', styleId)
  // 'rStyle' is first in RPR_CHILD_ORDER, so this also guarantees it lands
  // as rPr's first child, as CT_RPr requires.
  insertRPrChildInOrder(rPr, 'rStyle', rStyleEl)
  stripTrackedProps(rPr)
}

/**
 * Creates (or redefines/reuses) a single named character style and applies
 * it to every run in `sourceRunRefs` via w:rStyle - even runs that started
 * as pure direct/inherited formatting. `sourceRunRefs` is a flat list (not
 * grouped by Style Report entity/variant) so this function stays decoupled
 * from how the report groups things - callers typically build it with
 * collectRunRefsForVariantIds(). Passing an empty array is valid: it just
 * creates/redefines the style definition itself without touching any runs
 * (e.g. the "+ New Style" flow, or reusing an existing style purely to
 * tweak its look).
 *
 * Always creates/updates a character style (never a paragraph style) -
 * repointing w:pStyle instead would risk silently altering out-of-scope
 * paragraph properties (alignment, spacing, numbering). Use
 * mergeParagraphStyle() below when the user explicitly wants a
 * paragraph-level style (e.g. a bullet/numbered list).
 *
 * Pass `reuseExistingStyleId` to redefine/extend an already-created style
 * (e.g. editing an existing UserStyleRecord, or targeting an existing style
 * from the merge dialog) instead of creating a new one. Without it, a
 * style the document already has under the same name is redefined rather
 * than duplicated (see findSameNamedStyleId).
 *
 * Mutates parsedDocx.documentXml/stylesXml in place. Caller is expected to
 * recompute buildStyleReport() afterward - the merged runs will naturally
 * regroup into one entity/variant.
 */
export function mergeStyles(
  parsedDocx: ParsedDocx,
  sourceRunRefs: RunRef[],
  targetProps: FormattingSignature,
  name: string,
  reuseExistingStyleId?: string,
): string {
  const { stylesXml } = parsedDocx
  const stylesRoot = stylesXml.getElementsByTagNameNS(NS.w, 'styles')[0]
  if (!stylesRoot) {
    throw new Error('This document\'s styles.xml is missing a <w:styles> root - cannot merge.')
  }

  let styleId: string
  name = resolveUserStyleName(stylesXml, name, 'character')
  const reuseId = reuseExistingStyleId ?? findSameNamedStyleId(stylesXml, name, 'character') ?? undefined

  if (reuseId) {
    const existingStyleEl = findStyleElementById(stylesRoot, reuseId)
    if (!existingStyleEl) {
      throw new Error(`Cannot reuse style "${reuseId}" - it no longer exists.`)
    }
    styleId = reuseId
    updateStyleNameAndRPr(existingStyleEl, name, targetProps)
  } else {
    styleId = generateUniqueStyleId(stylesXml, name)
    const hasDefaultParagraphFont = collectExistingStyleIds(stylesXml).has('DefaultParagraphFont')
    const newStyleEl = buildStyleElement(stylesXml, styleId, name, targetProps, hasDefaultParagraphFont)
    // Appending at the end of <w:styles> is always schema-safe: repeated
    // w:style elements have no relative-order constraint among themselves.
    stylesRoot.appendChild(newStyleEl)
  }

  for (const runRef of sourceRunRefs) {
    applyStyleToRun(runRef.runElement, styleId)
  }

  return styleId
}

/** Builds a new paragraph-type <w:style>. CT_Style's child order for what we
 * write is name, basedOn, pPr, rPr - pPr (carrying the style's w:numPr)
 * comes before rPr, unlike buildStyleElement's character-style shape which
 * has no pPr at all. */
function buildParagraphStyleElement(
  doc: XMLDocument,
  styleId: string,
  name: string,
  targetProps: FormattingSignature,
  numPr: StyleNumPr,
  hasNormal: boolean,
): Element {
  const styleEl = createWEl(doc, 'style')
  setWAttr(styleEl, 'type', 'paragraph')
  setWAttr(styleEl, 'styleId', styleId)

  const nameEl = createWEl(doc, 'name')
  setWAttr(nameEl, 'val', name)
  styleEl.appendChild(nameEl)

  if (hasNormal) {
    const basedOnEl = createWEl(doc, 'basedOn')
    setWAttr(basedOnEl, 'val', 'Normal')
    styleEl.appendChild(basedOnEl)
  }

  const rPr = createWEl(doc, 'rPr')
  writeSignatureIntoRPr(rPr, targetProps)
  styleEl.appendChild(rPr)

  setStyleNumPr(styleEl, numPr)

  return styleEl
}

/** CT_PPrBase children that must come *before* w:numPr. */
const PPR_CHILDREN_BEFORE_NUMPR = new Set(['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl'])

/** Writes a style's own <w:pPr>/<w:numPr> - replacing whatever numPr it had.
 * A real list writes ilvl + numId; 'off' writes numId="0", OOXML's explicit
 * "no numbering", so the style's paragraphs stay unnumbered even if its
 * basedOn chain carries a list. Creates pPr (right before rPr, per CT_Style)
 * if needed, and slots numPr into CT_PPrBase order within it. */
function setStyleNumPr(styleEl: Element, numPr: StyleNumPr): void {
  const doc = styleEl.ownerDocument
  let pPr = wChild(styleEl, 'pPr')
  if (!pPr) {
    pPr = createWEl(doc, 'pPr')
    styleEl.insertBefore(pPr, wChild(styleEl, 'rPr'))
  }
  removeWChild(pPr, 'numPr')

  const numPrEl = createWEl(doc, 'numPr')
  if (numPr !== 'off') {
    const ilvlEl = createWEl(doc, 'ilvl')
    setWAttr(ilvlEl, 'val', String(numPr.ilvl))
    numPrEl.appendChild(ilvlEl)
  }
  const numIdEl = createWEl(doc, 'numId')
  setWAttr(numIdEl, 'val', numPr === 'off' ? '0' : numPr.numId)
  numPrEl.appendChild(numIdEl)

  let before: Element | null = null
  for (let i = 0; i < pPr.children.length; i++) {
    if (!PPR_CHILDREN_BEFORE_NUMPR.has(pPr.children[i].localName)) {
      before = pPr.children[i]
      break
    }
  }
  pPr.insertBefore(numPrEl, before)
}

function updateParagraphStyleDefinition(
  styleEl: Element,
  name: string,
  targetProps: FormattingSignature,
  numPr: StyleNumPr,
): void {
  const doc = styleEl.ownerDocument

  let nameEl = wChild(styleEl, 'name')
  if (!nameEl) {
    nameEl = createWEl(doc, 'name')
    styleEl.insertBefore(nameEl, styleEl.firstChild)
  }
  setWAttr(nameEl, 'val', name)

  let rPr = wChild(styleEl, 'rPr')
  if (!rPr) {
    rPr = createWEl(doc, 'rPr')
    styleEl.appendChild(rPr)
  }
  writeSignatureIntoRPr(rPr, targetProps)

  setStyleNumPr(styleEl, numPr)
}

/** Decides the numPr a paragraph style should carry for `listFormat`:
 * - 'none' is always an explicit 'off' (numId="0") - so a "No Numbering"
 *   style really does strip numbering from every paragraph merged into it;
 * - an explicit `listNumPr` (a shared heading list, or a list copied from
 *   Document B) wins next;
 * - redefining a style that already sits on a list of the right kind keeps
 *   that list - re-merging into "heading 2" must not knock it off the shared
 *   multilevel heading list (or restart its numbering) by minting a new one;
 * - otherwise a fresh single-level list is created. */
function chooseStyleNumPr(
  parsedDocx: ParsedDocx,
  listFormat: ListFormat,
  existingStyleEl: Element | null,
  listNumPr: { numId: string; ilvl: number } | undefined,
): StyleNumPr {
  if (listFormat === 'none') return 'off'
  if (listNumPr) return listNumPr
  const current = existingStyleEl ? readStyleElementNumPr(existingStyleEl) : null
  if (
    current &&
    current !== 'off' &&
    resolveListLevelFormat(parsedDocx.numberingXml, current.numId, current.ilvl) === listFormat
  ) {
    return current
  }
  return { numId: createListNumId(parsedDocx, listFormat), ilvl: 0 }
}

/** The numPr a style element currently carries directly (no basedOn walk) -
 * how addDefaultStyles() finds the shared heading list to keep reusing. */
export function readStyleNumPrById(stylesXml: XMLDocument, styleId: string): StyleNumPr | null {
  const stylesRoot = stylesXml.getElementsByTagNameNS(NS.w, 'styles')[0]
  const styleEl = stylesRoot ? findStyleElementById(stylesRoot, styleId) : null
  return styleEl ? readStyleElementNumPr(styleEl) : null
}

/** Points a paragraph at `styleId` via w:pStyle. Also drops any *direct*
 * w:numPr already on the paragraph: a direct numPr always outranks the
 * style's own in the OOXML cascade, so leaving one in place would silently
 * keep the paragraph on its old list (or no list) instead of picking up the
 * new style's - the paragraph-level equivalent of applyStyleToRun() clearing
 * a run's direct formatting before pointing it at a character style. */
function applyParagraphStyle(paragraphEl: Element, styleId: string): void {
  let pPr = wChild(paragraphEl, 'pPr')
  if (!pPr) {
    pPr = createWEl(paragraphEl.ownerDocument, 'pPr')
    paragraphEl.insertBefore(pPr, paragraphEl.firstChild)
  }

  let pStyleEl = wChild(pPr, 'pStyle')
  if (!pStyleEl) {
    pStyleEl = createWEl(paragraphEl.ownerDocument, 'pStyle')
    // pStyle must be pPr's first child per CT_PPr.
    pPr.insertBefore(pStyleEl, pPr.firstChild)
  }
  setWAttr(pStyleEl, 'val', styleId)

  removeWChild(pPr, 'numPr')
}

/** Strips a run down to formatting the paragraph style can actually show
 * through: removes any w:rStyle (a character style would otherwise keep
 * outranking the paragraph style) and every tracked direct property, same
 * as applyStyleToRun() does for the character-style path - just without
 * pointing at a new rStyle, since there isn't one here. */
function clearRunDirectFormatting(runEl: Element): void {
  const rPr = wChild(runEl, 'rPr')
  if (!rPr) return
  removeWChild(rPr, 'rStyle')
  stripTrackedProps(rPr)
}

/**
 * The paragraph-style counterpart to mergeStyles(): creates (or
 * redefines/reuses) a named paragraph style - optionally with its own
 * bullet or numbered list, via w:numPr on the style's own <w:pPr> so every
 * paragraph in the style shares one continuously-incrementing list, the
 * same convention Word's built-in "List Bullet"/"List Number" styles use -
 * and applies it to every paragraph among `sourceRunRefs` via w:pStyle.
 *
 * Operates on whole paragraphs (deduplicated - a paragraph with several
 * selected runs only gets w:pStyle set once), unlike mergeStyles() which
 * operates per-run, because w:pStyle is fundamentally a paragraph-level
 * concept: the list a paragraph is part of, its outline level, its
 * alignment, etc. Every affected run's own direct/character-style
 * formatting is cleared (clearRunDirectFormatting) so the paragraph style's
 * <w:rPr> actually determines how the text looks, matching the same
 * "merge fully subsumes formatting" guarantee mergeStyles() makes.
 *
 * Numbering always ends up matching `listFormat`, however the source
 * paragraph got its numbers (a numbered style, or Word's numbering button,
 * i.e. a direct w:numPr): the paragraph's direct numPr is dropped, and a
 * 'none' style carries an explicit numId="0" so nothing inherited can bring
 * numbers back (see chooseStyleNumPr). `listNumPr` pins the style to a
 * specific list level - the shared heading list, or a list copied from
 * Document B - instead of a fresh single-level list.
 *
 * Mutates parsedDocx.documentXml/stylesXml/numberingXml in place. Caller is
 * expected to recompute buildStyleReport() afterward.
 */
export function mergeParagraphStyle(
  parsedDocx: ParsedDocx,
  sourceRunRefs: RunRef[],
  targetProps: FormattingSignature,
  name: string,
  listFormat: ListFormat,
  reuseExistingStyleId?: string,
  listNumPr?: { numId: string; ilvl: number },
): string {
  const { stylesXml } = parsedDocx
  const stylesRoot = stylesXml.getElementsByTagNameNS(NS.w, 'styles')[0]
  if (!stylesRoot) {
    throw new Error('This document\'s styles.xml is missing a <w:styles> root - cannot merge.')
  }

  let styleId: string
  name = resolveUserStyleName(stylesXml, name, 'paragraph')
  const reuseId = reuseExistingStyleId ?? findSameNamedStyleId(stylesXml, name, 'paragraph') ?? undefined

  if (reuseId) {
    const existingStyleEl = findStyleElementById(stylesRoot, reuseId)
    if (!existingStyleEl) {
      throw new Error(`Cannot reuse style "${reuseId}" - it no longer exists.`)
    }
    styleId = reuseId
    const numPr = chooseStyleNumPr(parsedDocx, listFormat, existingStyleEl, listNumPr)
    updateParagraphStyleDefinition(existingStyleEl, name, targetProps, numPr)
  } else {
    styleId = generateUniqueStyleId(stylesXml, name)
    const hasNormal = collectExistingStyleIds(stylesXml).has('Normal')
    const numPr = chooseStyleNumPr(parsedDocx, listFormat, null, listNumPr)
    const newStyleEl = buildParagraphStyleElement(stylesXml, styleId, name, targetProps, numPr, hasNormal)
    stylesRoot.appendChild(newStyleEl)
  }

  const paragraphs = new Set<Element>()
  for (const runRef of sourceRunRefs) {
    paragraphs.add(runRef.paragraphElement)
    clearRunDirectFormatting(runRef.runElement)
  }
  for (const paragraphEl of paragraphs) {
    applyParagraphStyle(paragraphEl, styleId)
  }

  return styleId
}
