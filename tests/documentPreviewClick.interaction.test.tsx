import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { DocumentPreviewPanel } from '../src/components/DocumentPreviewPanel'
import { buildStyleReport } from '../src/lib/ooxml/styleReport'
import { makeParsedDocx } from './testUtils'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom doesn't implement scrollIntoView.
Element.prototype.scrollIntoView = vi.fn()

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const documentXml = `<w:document ${W}><w:body>
  <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold text</w:t></w:r></w:p>
  <w:p><w:r><w:t>Plain text</w:t></w:r></w:p>
</w:body></w:document>`

function renderPreview(
  selectable: 'all' | 'none' = 'all',
  selectedVariantIds: (styleReport: ReturnType<typeof buildStyleReport>) => Set<string> = () => new Set(),
) {
  const parsedDocx = makeParsedDocx({ documentXml })
  const styleReport = buildStyleReport(parsedDocx)
  const onToggleVariant = vi.fn()
  const onSelectOnlyVariant = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <DocumentPreviewPanel
        parsedDocx={parsedDocx}
        styleReport={styleReport}
        selectedVariantIds={selectedVariantIds(styleReport)}
        selectableStyleReport={selectable === 'all' ? styleReport : []}
        onSelectOnlyVariant={onSelectOnlyVariant}
        onToggleVariant={onToggleVariant}
        paragraphMarkers={new Map()}
        referenceDoc={{ status: 'idle' } as never}
        isMergingContent={false}
        onOpenContentMerge={() => {}}
      />,
    )
  })
  // Each paragraph wraps its runs in an outer span with the same text, so take
  // the innermost (last) match - that's the run itself.
  const runSpan = (text: string) =>
    Array.from(container.querySelectorAll('span'))
      .filter((s) => s.textContent === text)
      .at(-1) as HTMLElement
  return { styleReport, onToggleVariant, onSelectOnlyVariant, runSpan, container }
}

const click = (el: HTMLElement, init: MouseEventInit = {}) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  })

describe('DocumentPreviewPanel click-to-select', () => {
  it("a plain click selects only that run's variant (replacing any others)", () => {
    const { styleReport, onToggleVariant, onSelectOnlyVariant, runSpan } = renderPreview()
    const boldVariant = styleReport.find((e) => e.signature.bold)!.variants[0]
    click(runSpan('Bold text'))
    expect(onSelectOnlyVariant).toHaveBeenCalledExactlyOnceWith(boldVariant.id)
    expect(onToggleVariant).not.toHaveBeenCalled()
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
  ])('%s-click toggles the variant so several can be selected', (_name, init) => {
    const { styleReport, onToggleVariant, onSelectOnlyVariant, runSpan } = renderPreview()
    const boldVariant = styleReport.find((e) => e.signature.bold)!.variants[0]
    click(runSpan('Bold text'), init)
    expect(onToggleVariant).toHaveBeenCalledExactlyOnceWith(boldVariant.id)
    expect(onSelectOnlyVariant).not.toHaveBeenCalled()
  })

  it('a plain click on the only selected variant deselects it', () => {
    const { styleReport, onToggleVariant, onSelectOnlyVariant, runSpan } = renderPreview('all', (report) =>
      new Set([report.find((e) => e.signature.bold)!.variants[0].id]),
    )
    click(runSpan('Bold text'))
    expect(onToggleVariant).toHaveBeenCalledExactlyOnceWith(styleReport.find((e) => e.signature.bold)!.variants[0].id)
    expect(onSelectOnlyVariant).not.toHaveBeenCalled()
  })

  it('a plain click on a variant that is one of several selected narrows to just it', () => {
    const { onToggleVariant, onSelectOnlyVariant, runSpan } = renderPreview('all', (report) =>
      new Set(report.flatMap((e) => e.variants.map((v) => v.id))),
    )
    click(runSpan('Bold text'))
    expect(onSelectOnlyVariant).toHaveBeenCalledOnce()
    expect(onToggleVariant).not.toHaveBeenCalled()
  })

  it('does nothing for a run whose variant is not in the selectable list', () => {
    const { onToggleVariant, onSelectOnlyVariant, runSpan } = renderPreview('none')
    click(runSpan('Bold text'))
    expect(onToggleVariant).not.toHaveBeenCalled()
    expect(onSelectOnlyVariant).not.toHaveBeenCalled()
  })

  it('the header hint names the multi-select key', () => {
    const { container } = renderPreview()
    expect(container.textContent).toMatch(/Click text to select a style \(Hold (Ctrl|Cmd) to select multiple\)/)
  })
})
