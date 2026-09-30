import type { ListFormat, ParsedDocx, StyleDef } from '../../types/ooxml'
import { NS } from './constants'
import { createWEl, setWAttr, wAttr, wChild, wChildren } from './domUtils'
import { buildStylesMap } from './styleResolution'

interface NumberingLevel {
  numFmt: string
  lvlText: string
  start: number
}

interface NumberingContext {
  /** numId -> abstractNumId, from <w:num>'s <w:abstractNumId>. */
  numToAbstract: Map<string, string>
  /** abstractNumId -> levels indexed by ilvl. */
  abstractLevels: Map<string, NumberingLevel[]>
}

/** A resolved list marker for one paragraph - e.g. `{ text: '2.', ilvl: 0 }`
 * for the second item of a top-level numbered list, or `{ text: '•', ilvl: 1 }`
 * for a nested bullet. `text` is '' for numFmt "none" (an indented-but-unmarked
 * list level), which still carries `ilvl` so the preview can indent it. */
export interface ParagraphMarker {
  text: string
  ilvl: number
}

function parseNumberingXml(numberingXml: XMLDocument | null): NumberingContext {
  const numToAbstract = new Map<string, string>()
  const abstractLevels = new Map<string, NumberingLevel[]>()
  const root = numberingXml?.getElementsByTagNameNS(NS.w, 'numbering')[0]
  if (!root) return { numToAbstract, abstractLevels }

  for (const abstractEl of wChildren(root, 'abstractNum')) {
    const abstractNumId = wAttr(abstractEl, 'abstractNumId')
    if (!abstractNumId) continue
    const levels: NumberingLevel[] = []
    for (const lvlEl of wChildren(abstractEl, 'lvl')) {
      const ilvl = Number.parseInt(wAttr(lvlEl, 'ilvl') ?? '0', 10)
      if (Number.isNaN(ilvl)) continue
      levels[ilvl] = {
        numFmt: wAttr(wChild(lvlEl, 'numFmt'), 'val') ?? 'decimal',
        lvlText: wAttr(wChild(lvlEl, 'lvlText'), 'val') ?? '',
        start: Number.parseInt(wAttr(wChild(lvlEl, 'start'), 'val') ?? '1', 10) || 1,
      }
    }
    abstractLevels.set(abstractNumId, levels)
  }

  for (const numEl of wChildren(root, 'num')) {
    const numId = wAttr(numEl, 'numId')
    const abstractNumId = wAttr(wChild(numEl, 'abstractNumId'), 'val')
    if (numId && abstractNumId) numToAbstract.set(numId, abstractNumId)
  }

  return { numToAbstract, abstractLevels }
}

interface ParagraphNumPr {
  numId: string
  ilvl: number
}

/** Reads a <w:numPr> directly on `pPr` (not inherited) - `undefined` means
 * "no numPr element at all" (keep looking up the style chain), while `null`
 * means "numId=0", OOXML's explicit override for "this paragraph has no
 * numbering even though its style would otherwise give it one". */
function directNumPr(pPr: Element | null): ParagraphNumPr | null | undefined {
  const numPr = wChild(pPr, 'numPr')
  if (!numPr) return undefined
  const numId = wAttr(wChild(numPr, 'numId'), 'val')
  if (!numId || numId === '0') return null
  const ilvl = Number.parseInt(wAttr(wChild(numPr, 'ilvl'), 'val') ?? '0', 10)
  return { numId, ilvl: Number.isNaN(ilvl) ? 0 : ilvl }
}

/** Walks a paragraph-style chain (starting at `styleId` itself, then each
 * w:basedOn ancestor) looking for the first <w:pPr>/<w:numPr> - shared by
 * resolveParagraphNumPr (starting from a paragraph's own w:pStyle) and
 * resolveStyleListFormat (starting from the style being asked about
 * directly, e.g. when materializing a Document B style that itself defines
 * a list, independent of any specific paragraph using it). */
function resolveNumPrFromStyleChain(
  styleId: string | null,
  stylesMap: Map<string, StyleDef>,
): ParagraphNumPr | null {
  let id = styleId
  const visited = new Set<string>()
  while (id && !visited.has(id)) {
    visited.add(id)
    const style = stylesMap.get(id)
    if (!style) break
    const fromStyle = directNumPr(style.pPrElement)
    if (fromStyle !== undefined) return fromStyle
    id = style.basedOnId
  }
  return null
}

/** Resolves the numbering a paragraph actually uses: its own direct
 * <w:pPr>/<w:numPr> if present, else the first one found walking its
 * paragraph style's w:basedOn chain - the same inheritance path
 * resolveRunFormatting uses for run properties, just for numPr instead. */
function resolveParagraphNumPr(paragraphEl: Element, stylesMap: Map<string, StyleDef>): ParagraphNumPr | null {
  const pPr = wChild(paragraphEl, 'pPr')
  const direct = directNumPr(pPr)
  if (direct !== undefined) return direct
  return resolveNumPrFromStyleChain(wAttr(wChild(pPr, 'pStyle'), 'val'), stylesMap)
}

/** Resolves whether a *style itself* (not any specific paragraph using it)
 * carries list numbering, and if so whether it's a bullet or a numbered
 * list - used when materializing a Document B style as a UserStyleRecord
 * (see referenceDocStyles.ts), so an imported style that's fundamentally a
 * bullet/numbered list (e.g. a custom "List Bullet"-alike) is recognized as
 * one immediately, rather than only once it happens to pick up its first
 * merged occurrence. Coerces every non-bullet numFmt (decimal, lowerLetter,
 * upperRoman, ...) down to this app's narrower 'decimal' creatable format -
 * StyleMash's own paragraph styles only ever create plain bullets or
 * decimal numbering (see ListFormat's own doc comment), so an imported
 * style that used e.g. lowerRoman numbering is approximated as decimal
 * rather than introducing a list format nothing else in the app can create
 * or edit. */
export function resolveStyleListFormat(
  styleId: string,
  stylesMap: Map<string, StyleDef>,
  numberingXml: XMLDocument | null,
): ListFormat {
  const numPr = resolveNumPrFromStyleChain(styleId, stylesMap)
  if (!numPr) return 'none'
  const { numToAbstract, abstractLevels } = parseNumberingXml(numberingXml)
  const abstractNumId = numToAbstract.get(numPr.numId)
  const levelDef = abstractNumId ? abstractLevels.get(abstractNumId)?.[numPr.ilvl] : undefined
  if (!levelDef || levelDef.numFmt === 'none') return 'none'
  return levelDef.numFmt === 'bullet' ? 'bullet' : 'decimal'
}

/** A representative preview of a *style's* list marker (not any specific
 * paragraph's) - e.g. "1.1." for a Document B heading style that sits two
 * levels deep in a multilevel list (Heading 1 at ilvl 0 -> "1.", Heading 2
 * at ilvl 1 -> "1.1.", Heading 3 at ilvl 2 -> "1.1.1.", ...), by expanding
 * every ancestor level's lvlText template (%1, %2, ...) against that
 * level's own `start` value - "what this marker looks like the first time
 * it's ever reached", the same convention Word's own multilevel-list
 * gallery preview uses, since there's no real document position to resolve
 * actual counters against here. Used at materialization time
 * (referenceDocStyles.ts) to capture a Document B style's true multilevel
 * depth as a fixed preview string on its UserStyleRecord - unlike
 * resolveStyleListFormat's coarse bullet/decimal, which only tracks what
 * StyleMash's own single-level createListNumId() is capable of actually
 * creating. Returns undefined when the style has no list numbering, or its
 * abstractNum can't be resolved. */
export function buildStylePreviewMarker(
  styleId: string,
  stylesMap: Map<string, StyleDef>,
  numberingXml: XMLDocument | null,
): string | undefined {
  const numPr = resolveNumPrFromStyleChain(styleId, stylesMap)
  if (!numPr) return undefined
  const { numToAbstract, abstractLevels } = parseNumberingXml(numberingXml)
  const abstractNumId = numToAbstract.get(numPr.numId)
  const levels = abstractNumId ? abstractLevels.get(abstractNumId) : undefined
  const levelDef = levels?.[numPr.ilvl]
  if (!levels || !levelDef) return undefined
  const counts = levels.slice(0, numPr.ilvl + 1).map((lvl) => lvl?.start ?? 1)
  return buildMarkerText(levelDef, levels, counts) || undefined
}

function toLetters(n: number, upper: boolean): string {
  let x = n
  let s = ''
  while (x > 0) {
    const rem = (x - 1) % 26
    s = String.fromCharCode(97 + rem) + s
    x = Math.floor((x - 1) / 26)
  }
  return upper ? s.toUpperCase() : s
}

const ROMAN_TABLE: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]

function toRoman(n: number, upper: boolean): string {
  let x = n
  let s = ''
  for (const [value, symbol] of ROMAN_TABLE) {
    while (x >= value) {
      s += symbol
      x -= value
    }
  }
  return upper ? s.toUpperCase() : s
}

function formatCounter(n: number, numFmt: string): string {
  switch (numFmt) {
    case 'decimalZero':
      return String(n).padStart(2, '0')
    case 'lowerLetter':
      return toLetters(n, false)
    case 'upperLetter':
      return toLetters(n, true)
    case 'lowerRoman':
      return toRoman(n, false)
    case 'upperRoman':
      return toRoman(n, true)
    default:
      return String(n)
  }
}

/** Expands a level's `lvlText` template (e.g. "%1." or "%1.%2)") against the
 * current per-level counters - %1 is the outermost level's counter, %2 the
 * next, etc. Bullets ignore lvlText's literal glyph (almost always a
 * Wingdings/Symbol-only private-use character no installed web font can
 * render) in favor of a plain "•", consistent with signatureToCss's own
 * web-safe-font fallback philosophy for this preview. */
function buildMarkerText(levelDef: NumberingLevel, levels: NumberingLevel[], counts: number[]): string {
  if (levelDef.numFmt === 'bullet') return '•'
  if (levelDef.numFmt === 'none') return ''
  return levelDef.lvlText.replace(/%(\d)/g, (_match, digit: string) => {
    const idx = Number.parseInt(digit, 10) - 1
    const ancestorLevel = levels[idx]
    const value = counts[idx] ?? ancestorLevel?.start ?? 1
    return formatCounter(value, ancestorLevel?.numFmt ?? levelDef.numFmt)
  })
}

/** Resolves every list marker in the document in one pass, keyed by the
 * live paragraph Element so DocumentPreviewPanel and the Style Report can
 * both look up "does this paragraph have a list marker, and what is it"
 * without re-deriving numbering state independently. Numbering is
 * inherently sequential (each level's counter depends on every prior
 * paragraph using that numId), so this must walk the whole document in
 * order rather than being computed per-paragraph on demand. */
export function buildParagraphMarkers(parsedDocx: ParsedDocx): Map<Element, ParagraphMarker> {
  const markers = new Map<Element, ParagraphMarker>()
  const stylesMap = buildStylesMap(parsedDocx.stylesXml)
  const { numToAbstract, abstractLevels } = parseNumberingXml(parsedDocx.numberingXml)
  if (numToAbstract.size === 0) return markers

  // numId -> counts per ilvl (the value last emitted at that level, 1-based).
  const counts = new Map<string, number[]>()

  const paragraphEls = parsedDocx.documentXml.getElementsByTagNameNS(NS.w, 'p')
  for (let i = 0; i < paragraphEls.length; i++) {
    const paragraphEl = paragraphEls[i]
    const numPr = resolveParagraphNumPr(paragraphEl, stylesMap)
    if (!numPr) continue

    const abstractNumId = numToAbstract.get(numPr.numId)
    const levels = abstractNumId ? abstractLevels.get(abstractNumId) : undefined
    const levelDef = levels?.[numPr.ilvl]
    if (!levels || !levelDef) continue

    let levelCounts = counts.get(numPr.numId)
    if (!levelCounts) {
      levelCounts = []
      counts.set(numPr.numId, levelCounts)
    }
    // Reaching a level before its parents (a heading 3 with no heading 1
    // yet) shows the parents at their start value and - as Word does -
    // counts them as used, so the next heading 1 is "2", not "1".
    for (let parent = 0; parent < numPr.ilvl; parent++) {
      levelCounts[parent] ??= levels[parent]?.start ?? 1
    }
    levelCounts[numPr.ilvl] = (levelCounts[numPr.ilvl] ?? levelDef.start - 1) + 1
    // A paragraph at a shallower level restarts every deeper level's count,
    // so the next time e.g. "1.a" is reached it starts over from "a" again.
    levelCounts.length = numPr.ilvl + 1

    markers.set(paragraphEl, { text: buildMarkerText(levelDef, levels, levelCounts), ilvl: numPr.ilvl })
  }

  return markers
}

const EMPTY_NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${NS.w}"></w:numbering>`

/** Returns `parsedDocx.numberingXml`, creating an empty one first if the
 * document had no word/numbering.xml part at all (most docs without any
 * list already in them). This is the one place numberingXml is ever
 * *replaced* rather than mutated in place - see the field's own doc comment
 * in types/ooxml.ts, which this makes no longer strictly true once a list
 * style is created; every subsequent read/write goes through this same live
 * document. serializeDocx() is responsible for actually writing the new
 * part (plus registering it in [Content_Types].xml and document.xml.rels)
 * into the zip at save time - nothing here touches the zip. */
export function ensureNumberingXml(parsedDocx: ParsedDocx): XMLDocument {
  if (!parsedDocx.numberingXml) {
    parsedDocx.numberingXml = new DOMParser().parseFromString(EMPTY_NUMBERING_XML, 'application/xml')
  }
  return parsedDocx.numberingXml
}

function nextAvailableId(root: Element, tagName: 'abstractNum' | 'num', attrName: string): string {
  let max = 0
  for (const el of wChildren(root, tagName)) {
    const value = Number.parseInt(wAttr(el, attrName) ?? '', 10)
    if (!Number.isNaN(value) && value > max) max = value
  }
  return String(max + 1)
}

/** Creates a new single-level abstractNum/num pair for a freshly-created
 * paragraph style's own list (see mergeStyles.ts#mergeParagraphStyle) and
 * returns its numId. Always a fresh pair, never reused across styles - each
 * user-created list style gets its own independent numbering sequence, the
 * same way Word's built-in "List Bullet"/"List Number" styles each own one.
 * Bullets are written as a literal "•" (skipping the Wingdings-glyph
 * convention real Word bullet lists use) since that's exactly what
 * DocumentPreviewPanel/StyleReportPanel already render for any bullet
 * format - consistent rendering between a StyleMash-authored list and one
 * read from an existing document. */
export function createListNumId(parsedDocx: ParsedDocx, format: Exclude<ListFormat, 'none'>): string {
  const numberingXml = ensureNumberingXml(parsedDocx)
  const abstractEl = createWEl(numberingXml, 'abstractNum')

  const lvlEl = createWEl(numberingXml, 'lvl')
  setWAttr(lvlEl, 'ilvl', '0')
  const startEl = createWEl(numberingXml, 'start')
  setWAttr(startEl, 'val', '1')
  lvlEl.appendChild(startEl)
  const numFmtEl = createWEl(numberingXml, 'numFmt')
  setWAttr(numFmtEl, 'val', format)
  lvlEl.appendChild(numFmtEl)
  const lvlTextEl = createWEl(numberingXml, 'lvlText')
  setWAttr(lvlTextEl, 'val', format === 'bullet' ? '•' : '%1.')
  lvlEl.appendChild(lvlTextEl)
  const lvlJcEl = createWEl(numberingXml, 'lvlJc')
  setWAttr(lvlJcEl, 'val', 'left')
  lvlEl.appendChild(lvlJcEl)
  abstractEl.appendChild(lvlEl)

  return registerAbstractNum(numberingXml, abstractEl)
}

/** A paragraph style's own list assignment, as written into its
 * <w:pPr>/<w:numPr>: a real list level, or 'off' - an explicit numId="0",
 * OOXML's "no numbering here, whatever the basedOn chain or a direct
 * numbering button said" (how Word's own "Heading 2 No Numbering"-style
 * variants are built). */
export type StyleNumPr = { numId: string; ilvl: number } | 'off'

/** Like resolveNumPrFromStyleChain, but keeps an explicit numId="0" apart
 * from "no numPr anywhere in the chain" (null) - the difference between a
 * style that deliberately turns numbering off and one that simply never
 * mentions it. */
export function resolveStyleNumPr(styleId: string, stylesMap: Map<string, StyleDef>): StyleNumPr | null {
  let id: string | null = styleId
  const visited = new Set<string>()
  while (id && !visited.has(id)) {
    visited.add(id)
    const style = stylesMap.get(id)
    if (!style) break
    const fromStyle = directNumPr(style.pPrElement)
    if (fromStyle === null) return 'off'
    if (fromStyle !== undefined) return fromStyle
    id = style.basedOnId
  }
  return null
}

/** Reads the <w:numPr> written directly on a style element's own <w:pPr>
 * (no basedOn walk) - null when it has none. */
export function readStyleElementNumPr(styleEl: Element): StyleNumPr | null {
  const direct = directNumPr(wChild(styleEl, 'pPr'))
  if (direct === undefined) return null
  return direct ?? 'off'
}

/** The bullet/decimal kind of one level of a list in `numberingXml`, coerced
 * the same way resolveStyleListFormat does - 'none' if it can't be resolved. */
export function resolveListLevelFormat(
  numberingXml: XMLDocument | null,
  numId: string,
  ilvl: number,
): ListFormat {
  const { numToAbstract, abstractLevels } = parseNumberingXml(numberingXml)
  const abstractNumId = numToAbstract.get(numId)
  const levelDef = abstractNumId ? abstractLevels.get(abstractNumId)?.[ilvl] : undefined
  if (!levelDef || levelDef.numFmt === 'none') return 'none'
  return levelDef.numFmt === 'bullet' ? 'bullet' : 'decimal'
}

/** Appends a new abstractNum (already populated with its levels) plus a
 * <w:num> pointing at it, keeping CT_Numbering's "every abstractNum before
 * every num" order. Returns the new numId. */
function registerAbstractNum(numberingXml: XMLDocument, abstractEl: Element): string {
  const root = numberingXml.getElementsByTagNameNS(NS.w, 'numbering')[0]
  const abstractNumId = nextAvailableId(root, 'abstractNum', 'abstractNumId')
  setWAttr(abstractEl, 'abstractNumId', abstractNumId)
  root.insertBefore(abstractEl, wChild(root, 'num'))

  const numId = nextAvailableId(root, 'num', 'numId')
  const numEl = createWEl(numberingXml, 'num')
  setWAttr(numEl, 'numId', numId)
  const abstractNumIdRefEl = createWEl(numberingXml, 'abstractNumId')
  setWAttr(abstractNumIdRefEl, 'val', abstractNumId)
  numEl.appendChild(abstractNumIdRefEl)
  root.appendChild(numEl)
  return numId
}

const HEADING_LIST_LEVELS = 9

/** Creates the one multilevel decimal list StyleMash's bundled heading
 * styles share - level 0 "%1", level 1 "%1.%2", ... level 8 - so heading 1..4
 * number as 1 / 1.1 / 1.1.1 / 1.1.1.1 in the saved file, exactly the markers
 * the New Styles panel previews (and the numbering CLEAN-STYLES.docx itself
 * uses). A single shared list is what makes "1.1" continue from the
 * preceding heading 1; one independent list per style (createListNumId)
 * would restart every heading level at "1." instead. */
export function createHeadingListNumId(parsedDocx: ParsedDocx): string {
  const numberingXml = ensureNumberingXml(parsedDocx)
  const abstractEl = createWEl(numberingXml, 'abstractNum')
  const multiLevelTypeEl = createWEl(numberingXml, 'multiLevelType')
  setWAttr(multiLevelTypeEl, 'val', 'multilevel')
  abstractEl.appendChild(multiLevelTypeEl)

  for (let ilvl = 0; ilvl < HEADING_LIST_LEVELS; ilvl++) {
    const lvlEl = createWEl(numberingXml, 'lvl')
    setWAttr(lvlEl, 'ilvl', String(ilvl))
    const startEl = createWEl(numberingXml, 'start')
    setWAttr(startEl, 'val', '1')
    lvlEl.appendChild(startEl)
    const numFmtEl = createWEl(numberingXml, 'numFmt')
    setWAttr(numFmtEl, 'val', 'decimal')
    lvlEl.appendChild(numFmtEl)
    const lvlTextEl = createWEl(numberingXml, 'lvlText')
    setWAttr(
      lvlTextEl,
      'val',
      Array.from({ length: ilvl + 1 }, (_, i) => `%${i + 1}`).join('.'),
    )
    lvlEl.appendChild(lvlTextEl)
    const lvlJcEl = createWEl(numberingXml, 'lvlJc')
    setWAttr(lvlJcEl, 'val', 'left')
    lvlEl.appendChild(lvlJcEl)
    abstractEl.appendChild(lvlEl)
  }

  return registerAbstractNum(numberingXml, abstractEl)
}

/** Copies the list definition behind `sourceNumId` (in another document's
 * numbering part - Document B's) into `targetDocx` as a brand-new
 * abstractNum/num pair and returns the new numId, so a Document B style
 * keeps its real multilevel numbering (e.g. "1.1" for a heading 2) instead
 * of being flattened into a single-level "1." list. References that would
 * dangle in the target document are dropped: w:pStyle links (Document B's
 * style ids), w:styleLink/w:numStyleLink, picture bullets, and the
 * nsid/tmpl identity fields (Word regenerates those). Returns null when the
 * source list can't be resolved or has no levels of its own (e.g. it
 * delegates to a numbering style via numStyleLink) - callers then fall back
 * to createListNumId(). */
export function copyListDefinition(
  targetDocx: ParsedDocx,
  sourceNumberingXml: XMLDocument | null,
  sourceNumId: string,
): string | null {
  const sourceRoot = sourceNumberingXml?.getElementsByTagNameNS(NS.w, 'numbering')[0]
  if (!sourceRoot) return null
  const sourceNumEl = wChildren(sourceRoot, 'num').find((el) => wAttr(el, 'numId') === sourceNumId)
  const sourceAbstractId = wAttr(wChild(sourceNumEl ?? null, 'abstractNumId'), 'val')
  const sourceAbstractEl = wChildren(sourceRoot, 'abstractNum').find(
    (el) => wAttr(el, 'abstractNumId') === sourceAbstractId,
  )
  if (!sourceAbstractEl || wChildren(sourceAbstractEl, 'lvl').length === 0) return null

  const numberingXml = ensureNumberingXml(targetDocx)
  const abstractEl = numberingXml.importNode(sourceAbstractEl, true) as Element
  for (const attr of Array.from(abstractEl.attributes)) {
    if (attr.namespaceURI !== NS.w) abstractEl.removeAttributeNode(attr)
  }
  for (const tag of ['nsid', 'tmpl', 'styleLink', 'numStyleLink']) {
    for (const el of wChildren(abstractEl, tag)) abstractEl.removeChild(el)
  }
  for (const lvlEl of wChildren(abstractEl, 'lvl')) {
    for (const attr of Array.from(lvlEl.attributes)) {
      if (attr.namespaceURI !== NS.w) lvlEl.removeAttributeNode(attr)
    }
    for (const tag of ['pStyle', 'lvlPicBulletId']) {
      for (const el of wChildren(lvlEl, tag)) lvlEl.removeChild(el)
    }
  }

  return registerAbstractNum(numberingXml, abstractEl)
}
