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

function renderPreview(selectable: 'all' | 'none' = 'all') {
  const parsedDocx = makeParsedDocx({ documentXml })
  const styleReport = buildStyleReport(parsedDocx)
  const onToggleVariant = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <DocumentPreviewPanel
        parsedDocx={parsedDocx}
        styleReport={styleReport}
        selectedVariantIds={new Set()}
        selectableStyleReport={selectable === 'all' ? styleReport : []}
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
  return { styleReport, onToggleVariant, runSpan }
}

describe('DocumentPreviewPanel click-to-select', () => {
  it("clicking a run toggles that run's variant", () => {
    const { styleReport, onToggleVariant, runSpan } = renderPreview()
    const boldVariant = styleReport.find((e) => e.signature.bold)!.variants[0]
    act(() => runSpan('Bold text').click())
    expect(onToggleVariant).toHaveBeenCalledExactlyOnceWith(boldVariant.id)
  })

  it('does nothing for a run whose variant is not in the selectable list', () => {
    const { onToggleVariant, runSpan } = renderPreview('none')
    act(() => runSpan('Bold text').click())
    expect(onToggleVariant).not.toHaveBeenCalled()
  })
})
