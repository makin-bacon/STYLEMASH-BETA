import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { useDocxWorkspace } from '../src/hooks/useDocxWorkspace'
import { NS } from '../src/lib/ooxml/constants'
import { DEFAULT_STYLES } from '../src/lib/ooxml/defaultStyles'
import type { FormattingSignature } from '../src/types/ooxml'

// Same flag (and reason) as styleVariantRow.interaction.test.tsx - this file
// mounts real components via react-dom/client directly.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const W = `xmlns:w="${NS.w}"`

const DOCUMENT_XML = `<?xml version="1.0"?>
<w:document ${W}><w:body>
  <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold text</w:t></w:r></w:p>
  <w:p><w:r><w:t>Plain text</w:t></w:r></w:p>
</w:body></w:document>`

const STYLES_XML = `<?xml version="1.0"?><w:styles ${W}></w:styles>`

const TARGET: FormattingSignature = {
  fontFamily: 'Arial',
  fontSizeHalfPt: 24,
  colorValue: 'auto',
  bold: true,
  italic: false,
  underline: null,
  strike: false,
}

async function makeDocxFile(stylesXml = STYLES_XML): Promise<File> {
  const zip = new JSZip()
  zip.file('word/document.xml', DOCUMENT_XML)
  zip.file('word/styles.xml', stylesXml)
  return new File([await zip.generateAsync({ type: 'blob' })], 'test.docx')
}

/** Mounts useDocxWorkspace inside <StrictMode>, exactly as src/main.tsx
 * does, and loads a document into it. StrictMode is the point of this
 * harness, not incidental: React deliberately invokes a reducer twice per
 * dispatch in development to surface reducers that aren't pure. Every merge
 * here goes through a mutating OOXML call, so a regression that moves one
 * of those calls back into the reducer shows up as duplicated work in the
 * assertions below rather than as a silent, save-time-only corruption. */
async function mountWorkspace(stylesXml?: string) {
  let api: ReturnType<typeof useDocxWorkspace> | null = null
  function Probe() {
    api = useDocxWorkspace()
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
  })

  const file = await makeDocxFile(stylesXml)
  await act(async () => {
    await api!.actions.loadFile(file)
  })

  return {
    get api() {
      return api!
    },
    styleIds: () =>
      Array.from(api!.state.parsedDocx!.stylesXml.getElementsByTagNameNS(NS.w, 'style')).map((el) =>
        el.getAttributeNS(NS.w, 'styleId'),
      ),
    numIds: () =>
      api!.state.parsedDocx!.numberingXml
        ? Array.from(api!.state.parsedDocx!.numberingXml.getElementsByTagNameNS(NS.w, 'num')).length
        : 0,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('useDocxWorkspace under StrictMode', () => {
  it('loads a document and builds a style report', async () => {
    const w = await mountWorkspace()
    expect(w.api.state.status).toBe('loaded')
    expect(w.api.state.styleReport.length).toBeGreaterThan(0)
    w.cleanup()
  })

  it('selectOnlyVariant replaces the whole selection; toggleSelectVariant adds to it', async () => {
    const w = await mountWorkspace()
    const ids = w.api.state.styleReport.flatMap((e) => e.variants.map((v) => v.id))
    expect(ids.length).toBeGreaterThan(1)

    act(() => w.api.actions.toggleSelectVariant(ids[0]))
    act(() => w.api.actions.toggleSelectVariant(ids[1]))
    expect([...w.api.state.selectedVariantIds]).toEqual([ids[0], ids[1]])

    act(() => w.api.actions.selectOnlyVariant(ids[1]))
    expect([...w.api.state.selectedVariantIds]).toEqual([ids[1]])

    act(() => w.api.actions.selectOnlyVariant(ids[0]))
    expect([...w.api.state.selectedVariantIds]).toEqual([ids[0]])
    w.cleanup()
  })

  it('a character merge creates exactly one <w:style>, not a duplicate per re-invocation', async () => {
    const w = await mountWorkspace()
    const variantId = w.api.state.styleReport[0].variants[0].id

    act(() => w.api.actions.toggleSelectVariant(variantId))
    act(() => w.api.actions.confirmMerge(TARGET, 'MyStyle', 'character', 'none'))

    expect(w.styleIds()).toEqual(['MyStyle'])
    expect(w.api.state.userStyles.map((r) => r.styleId)).toEqual(['MyStyle'])
    w.cleanup()
  })

  it('a paragraph list merge creates exactly one style and one numbering definition', async () => {
    const w = await mountWorkspace()
    const variantId = w.api.state.styleReport[0].variants[0].id

    act(() => w.api.actions.toggleSelectVariant(variantId))
    act(() => w.api.actions.confirmMerge(TARGET, 'MyList', 'paragraph', 'bullet'))

    expect(w.styleIds()).toEqual(['MyList'])
    expect(w.numIds()).toBe(1)
    w.cleanup()
  })

  it('"+ Defaults" adds each bundled style exactly once', async () => {
    const w = await mountWorkspace()
    act(() => w.api.actions.addDefaultStyles())

    expect(w.styleIds()).toHaveLength(DEFAULT_STYLES.length)
    expect(w.api.state.userStyles).toHaveLength(DEFAULT_STYLES.length)
    w.cleanup()
  })

  it('clicking "+ Defaults" twice redefines rather than duplicating', async () => {
    const w = await mountWorkspace()
    act(() => w.api.actions.addDefaultStyles())
    act(() => w.api.actions.addDefaultStyles())

    expect(w.styleIds()).toHaveLength(DEFAULT_STYLES.length)
    w.cleanup()
  })

  it('"+ Defaults" takes over a same-named style the document already has, and "Clear list" never deletes it', async () => {
    const w = await mountWorkspace(`<?xml version="1.0"?><w:styles ${W}>
      <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
    </w:styles>`)
    act(() => w.api.actions.addDefaultStyles())

    // One "heading 3", not the document's plus a lookalike Word would fold together.
    expect(w.styleIds()).toHaveLength(DEFAULT_STYLES.length)
    const h3 = w.api.state.userStyles.find((r) => r.name === 'heading 3')!
    expect(h3).toMatchObject({ styleId: 'Heading3', adoptedFromDocument: true })

    act(() => w.api.actions.clearUserStyles())
    expect(w.styleIds()).toEqual(['Heading3'])
    w.cleanup()
  })

  it('"+ Defaults" names the bundled character "Normal" NormalUser next to the document\'s paragraph Normal, once', async () => {
    const w = await mountWorkspace(`<?xml version="1.0"?><w:styles ${W}>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    </w:styles>`)
    act(() => w.api.actions.addDefaultStyles())
    act(() => w.api.actions.addDefaultStyles())

    const normal = w.api.state.userStyles.filter((r) => r.name.startsWith('Normal'))
    expect(normal.map((r) => [r.name, r.styleId])).toEqual([
      ['NormalUser', 'NormalUser'],
      ['Normal Bold', 'NormalBold'],
    ])
    expect(normal[0].adoptedFromDocument).toBeUndefined()
    // The document's own Normal plus one of each default - nothing doubled.
    expect(w.styleIds()).toHaveLength(DEFAULT_STYLES.length + 1)
    w.cleanup()
  })

  it('enabledDefaultStyleNames starts with every DEFAULT_STYLES name checked', async () => {
    const w = await mountWorkspace()
    expect(w.api.enabledDefaultStyleNames).toEqual(new Set(DEFAULT_STYLES.map((d) => d.name)))
    w.cleanup()
  })

  it('unchecking a style in "Customise your own style file" excludes it from "+ Defaults"', async () => {
    const w = await mountWorkspace()
    act(() => w.api.actions.toggleDefaultStyleEnabled('caption'))
    expect(w.api.enabledDefaultStyleNames.has('caption')).toBe(false)

    act(() => w.api.actions.addDefaultStyles())

    expect(w.api.state.userStyles.map((r) => r.name)).not.toContain('caption')
    expect(w.api.state.userStyles).toHaveLength(DEFAULT_STYLES.length - 1)
    w.cleanup()
  })

  it('enabledDefaultStyleNames survives "Mash a different file" (reset) - it is a preference, not document state', async () => {
    const w = await mountWorkspace()
    act(() => w.api.actions.toggleDefaultStyleEnabled('caption'))

    act(() => w.api.actions.reset())

    expect(w.api.state.status).toBe('empty')
    expect(w.api.enabledDefaultStyleNames.has('caption')).toBe(false)
    w.cleanup()
  })

  it('undo restores the document and the user-style list from before a merge', async () => {
    const w = await mountWorkspace()
    const variantId = w.api.state.styleReport[0].variants[0].id

    act(() => w.api.actions.toggleSelectVariant(variantId))
    act(() => w.api.actions.confirmMerge(TARGET, 'MyStyle', 'character', 'none'))
    expect(w.api.state.undoStack).toHaveLength(1)

    act(() => w.api.actions.undo())

    expect(w.styleIds()).toEqual([])
    expect(w.api.state.userStyles).toEqual([])
    expect(w.api.state.undoStack).toHaveLength(0)
    w.cleanup()
  })

  it('an "Edit XML" apply is undoable', async () => {
    const w = await mountWorkspace()
    const variantId = w.api.state.styleReport[0].variants[0].id

    act(() => w.api.actions.openXmlEditor(variantId))
    act(() => w.api.actions.applyXmlEdit('<w:rPr><w:i/></w:rPr>'))

    const serialize = () => new XMLSerializer().serializeToString(w.api.state.parsedDocx!.documentXml)
    expect(serialize()).toContain('<w:i/>')
    expect(w.api.state.undoStack).toHaveLength(1)

    act(() => w.api.actions.undo())

    expect(serialize()).not.toContain('<w:i/>')
    expect(serialize()).toContain('<w:b/>')
    w.cleanup()
  })

  it('surfaces a merge failure as an inline error instead of throwing', async () => {
    const w = await mountWorkspace()
    act(() => w.api.actions.confirmMerge(TARGET, 'Nope', 'character', 'none', 'NoSuchStyleId'))

    expect(w.api.state.mergeError).toMatch(/no longer exists/)
    expect(w.api.state.undoStack).toHaveLength(0)
    w.cleanup()
  })
})
