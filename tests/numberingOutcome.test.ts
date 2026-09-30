import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { ParsedDocx, RunRef, UserStyleRecord } from '../src/types/ooxml'
import { NS } from '../src/lib/ooxml/constants'
import { wAttr, wChild } from '../src/lib/ooxml/domUtils'
import { DEFAULT_STYLES, addDefaultStyles } from '../src/lib/ooxml/defaultStyles'
import { mergeParagraphStyle, mergeStyles, readStyleNumPrById } from '../src/lib/ooxml/mergeStyles'
import { buildParagraphMarkers } from '../src/lib/ooxml/numbering'
import { parseDocx } from '../src/lib/ooxml/parseDocx'
import { materializeReferenceDocStyles } from '../src/lib/ooxml/referenceDocStyles'
import { serializeDocx } from '../src/lib/ooxml/serializeDocx'
import { buildStyleReport } from '../src/lib/ooxml/styleReport'
import { makeParsedDocx } from './testUtils'

/** Checks that the *saved* file numbers each heading/list paragraph exactly
 * the way the New Styles panel previews the style it was merged into - and
 * that a "No Numbering" style strips numbers however they got there: from a
 * numbered paragraph style, or from Word's numbering button (a direct
 * w:numPr on the paragraph). */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

// A source document whose numbering comes from both places Word puts it:
// numId 1 is what the numbering button writes straight onto a paragraph;
// numId 2 is a multilevel heading list attached to the SrcHeading2 style.
const SOURCE_STYLES = `<w:styles ${W}>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="SrcHeading2">
    <w:name w:val="Source Heading 2"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr></w:pPr>
    <w:rPr><w:b/></w:rPr>
  </w:style>
</w:styles>`

const SOURCE_NUMBERING = `<w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1)"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`

const BUTTON_NUMBERED = (text: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
const STYLE_NUMBERED = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="SrcHeading2"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`

function paragraphs(parsedDocx: ParsedDocx): Element[] {
  return Array.from(parsedDocx.documentXml.getElementsByTagNameNS(NS.w, 'p'))
}

function runRefsOf(parsedDocx: ParsedDocx, paragraphEl: Element): RunRef[] {
  return buildStyleReport(parsedDocx)
    .flatMap((e) => e.variants.flatMap((v) => v.runRefs))
    .filter((ref) => ref.paragraphElement === paragraphEl)
}

/** The same dispatch useDocxWorkspace#mergeSelectedIntoTarget performs. */
function mergeInto(parsedDocx: ParsedDocx, record: UserStyleRecord, paragraphEl: Element): void {
  const runRefs = runRefsOf(parsedDocx, paragraphEl)
  if (record.kind === 'paragraph') {
    mergeParagraphStyle(parsedDocx, runRefs, record.targetSignature, record.name, record.listFormat, record.styleId)
  } else {
    mergeStyles(parsedDocx, runRefs, record.targetSignature, record.name, record.styleId)
  }
}

async function buildDocx(bodyXml: string): Promise<File> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`,
  )
  zip.file('word/document.xml', `<w:document ${W}><w:body>${bodyXml}</w:body></w:document>`)
  zip.file('word/styles.xml', SOURCE_STYLES)
  zip.file('word/numbering.xml', SOURCE_NUMBERING)
  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], 'fixture.docx')
}

/** Saves and re-opens the document, returning each paragraph's list marker
 * text ('' = unnumbered) as a fresh upload of the saved file resolves it. */
async function savedMarkers(parsedDocx: ParsedDocx): Promise<string[]> {
  const { blob } = await serializeDocx(parsedDocx)
  const reparsed = await parseDocx(new File([blob], 'saved.docx'))
  const markers = buildParagraphMarkers(reparsed)
  return paragraphs(reparsed).map((p) => markers.get(p)?.text ?? '')
}

describe('numbering in the saved file matches the New Styles panel', () => {
  it('"Heading 2 No Numbering" strips numbers from button-numbered and style-numbered paragraphs', async () => {
    const parsedDocx = await parseDocx(
      await buildDocx(BUTTON_NUMBERED('Button numbered') + STYLE_NUMBERED('Style numbered')),
    )
    expect(await savedMarkers(parsedDocx)).toEqual(['1)', '1.1']) // sanity: both start numbered

    const userStyles = addDefaultStyles(parsedDocx, [])
    const target = userStyles.find((r) => r.name === 'Heading 2 No Numbering')!
    expect(target.kind).toBe('paragraph')
    for (const p of paragraphs(parsedDocx)) mergeInto(parsedDocx, target, p)

    expect(await savedMarkers(parsedDocx)).toEqual(['', ''])
    // The style itself says "no numbering" explicitly, and neither paragraph
    // keeps a direct numPr that could outrank it.
    expect(readStyleNumPrById(parsedDocx.stylesXml, target.styleId)).toBe('off')
    for (const p of paragraphs(parsedDocx)) {
      expect(wChild(wChild(p, 'pPr'), 'numPr')).toBeNull()
      expect(wAttr(wChild(wChild(p, 'pPr'), 'pStyle'), 'val')).toBe(target.styleId)
    }
  })

  it('every heading and list default numbers (or not) exactly as its preview shows', async () => {
    const defs = DEFAULT_STYLES.filter((d) => d.category !== 'Body text styles')
    // Alternate the two ways a paragraph can arrive numbered.
    const body = defs
      .map((d, i) => (i % 2 === 0 ? BUTTON_NUMBERED(d.name) : STYLE_NUMBERED(d.name)))
      .join('')
    const parsedDocx = await parseDocx(await buildDocx(body))
    const userStyles = addDefaultStyles(parsedDocx, [])

    const paras = paragraphs(parsedDocx)
    defs.forEach((def, i) => mergeInto(parsedDocx, userStyles.find((r) => r.name === def.name)!, paras[i]))

    const markers = await savedMarkers(parsedDocx)
    const result = Object.fromEntries(defs.map((d, i) => [d.name, markers[i]]))
    const expected = Object.fromEntries(defs.map((d) => [d.name, d.listPreviewText ?? '']))
    expect(result).toEqual(expected)
    // Spelled out, so a data change to DEFAULT_STYLES can't make this vacuous.
    expect(result).toMatchObject({
      'heading 1': '1',
      'heading 2': '1.1',
      'heading 3': '1.1.1',
      'heading 4': '1.1.1.1',
      'Document title': '',
      'Heading 1 No Numbering': '',
      'Heading 2 No Numbering': '',
      'Heading 3 No Numbering': '',
      'Heading 4 No Numbering': '',
      'List Bullet': '•',
      'List Number': '1.',
    })
  })

  it('numbered headings share one list, so heading 2 continues from heading 1', async () => {
    const parsedDocx = await parseDocx(
      await buildDocx(['A', 'A.1', 'A.2', 'B', 'B.1'].map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')),
    )
    const userStyles = addDefaultStyles(parsedDocx, [])
    const h1 = userStyles.find((r) => r.name === 'heading 1')!
    const h2 = userStyles.find((r) => r.name === 'heading 2')!
    const paras = paragraphs(parsedDocx)
    ;[h1, h2, h2, h1, h2].forEach((record, i) => mergeInto(parsedDocx, record, paras[i]))

    expect(await savedMarkers(parsedDocx)).toEqual(['1', '1.1', '1.2', '2', '2.1'])
  })

  it('a heading reached before its parents counts them as used, like Word (1.1.1 then 2)', async () => {
    const parsedDocx = await parseDocx(
      await buildDocx(['deep', 'top'].map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')),
    )
    const userStyles = addDefaultStyles(parsedDocx, [])
    const paras = paragraphs(parsedDocx)
    mergeInto(parsedDocx, userStyles.find((r) => r.name === 'heading 3')!, paras[0])
    mergeInto(parsedDocx, userStyles.find((r) => r.name === 'heading 1')!, paras[1])

    // Matches what Microsoft Word renders for the same file.
    expect(await savedMarkers(parsedDocx)).toEqual(['1.1.1', '2'])
  })

  it('re-merging into a heading and re-clicking "+ Defaults" keep the one shared heading list', () => {
    const parsedDocx = makeParsedDocx({
      documentXml: `<w:document ${W}><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`,
    })
    const first = addDefaultStyles(parsedDocx, [])
    const h2 = first.find((r) => r.name === 'heading 2')!
    const before = readStyleNumPrById(parsedDocx.stylesXml, h2.styleId)
    const listCount = () => parsedDocx.numberingXml!.getElementsByTagNameNS(NS.w, 'abstractNum').length
    const countBefore = listCount()

    mergeInto(parsedDocx, h2, paragraphs(parsedDocx)[0])
    addDefaultStyles(parsedDocx, first)

    expect(readStyleNumPrById(parsedDocx.stylesXml, h2.styleId)).toEqual(before)
    expect(before).toMatchObject({ ilvl: 1 })
    const headingDefs = DEFAULT_STYLES.filter((d) => d.headingLevel !== undefined)
    for (const def of headingDefs) {
      const record = first.find((r) => r.name === def.name)!
      expect(readStyleNumPrById(parsedDocx.stylesXml, record.styleId)).toEqual({
        numId: (before as { numId: string }).numId,
        ilvl: def.headingLevel,
      })
    }
    // Every re-used style kept its list, so nothing new (or orphaned) was made.
    expect(listCount()).toBe(countBefore)
  })
})

describe('Document B ("Upload your own") numbering', () => {
  const referenceDocx = () =>
    makeParsedDocx({
      documentXml: `<w:document ${W}><w:body/></w:document>`,
      stylesXml: `<w:styles ${W}>
        <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
          <w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style>
        <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
          <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr></w:style>
        <w:style w:type="paragraph" w:styleId="Heading2NoNumbering"><w:name w:val="Heading 2 No Numbering"/>
          <w:basedOn w:val="Heading2"/>
          <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr></w:style>
      </w:styles>`,
      numberingXml: `<w:numbering ${W}>
        <w:abstractNum w:abstractNumId="3">
          <w:nsid w:val="475E3091"/><w:multiLevelType w:val="multilevel"/>
          <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading1"/><w:lvlText w:val="%1"/></w:lvl>
          <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading2"/><w:lvlText w:val="%1.%2"/></w:lvl>
        </w:abstractNum>
        <w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num>
      </w:numbering>`,
    })

  it('keeps a "No Numbering" style as a paragraph style that strips numbers', async () => {
    const parsedDocx = await parseDocx(
      await buildDocx(BUTTON_NUMBERED('Button numbered') + STYLE_NUMBERED('Style numbered')),
    )
    const records = materializeReferenceDocStyles(parsedDocx, referenceDocx(), [])
    const target = records.find((r) => r.name === 'Heading 2 No Numbering')!
    expect(target).toMatchObject({ kind: 'paragraph', listFormat: 'none' })

    for (const p of paragraphs(parsedDocx)) mergeInto(parsedDocx, target, p)
    expect(await savedMarkers(parsedDocx)).toEqual(['', ''])
  })

  it('carries a multilevel heading list across, shared by its heading styles', async () => {
    const parsedDocx = await parseDocx(
      await buildDocx(['A', 'A.1', 'B.1'].map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')),
    )
    const records = materializeReferenceDocStyles(parsedDocx, referenceDocx(), [])
    const h1 = records.find((r) => r.name === 'heading 1')!
    const h2 = records.find((r) => r.name === 'heading 2')!
    expect([h1.listPreviewText, h2.listPreviewText]).toEqual(['1', '1.1'])

    const paras = paragraphs(parsedDocx)
    ;[h1, h2, h2].forEach((record, i) => mergeInto(parsedDocx, record, paras[i]))
    expect(await savedMarkers(parsedDocx)).toEqual(['1', '1.1', '1.2'])

    // The copy drops references that would dangle in this document.
    const copied = Array.from(parsedDocx.numberingXml!.getElementsByTagNameNS(NS.w, 'abstractNum')).at(-1)!
    expect(copied.getElementsByTagNameNS(NS.w, 'pStyle')).toHaveLength(0)
    expect(copied.getElementsByTagNameNS(NS.w, 'nsid')).toHaveLength(0)
  })
})
