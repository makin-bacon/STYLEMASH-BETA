import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { AppHeader } from '../src/components/AppHeader'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AppHeader Help button', () => {
  it('calls onHelp (starts the tour) when clicked', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onHelp = vi.fn()
    act(() =>
      root.render(
        <AppHeader filename={null} isCustomizeOpen={false} onToggleCustomize={() => {}} onHelp={onHelp} />,
      ),
    )
    const help = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Help')!
    act(() => help.click())
    expect(onHelp).toHaveBeenCalledOnce()
    act(() => root.unmount())
    container.remove()
  })
})
