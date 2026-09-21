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

  it('has an About button, to the right of Help, that opens and closes the About modal', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        <AppHeader filename={null} isCustomizeOpen={false} onToggleCustomize={() => {}} onHelp={() => {}} />,
      ),
    )
    const buttons = Array.from(container.querySelectorAll('button'))
    const helpIndex = buttons.findIndex((b) => b.textContent === 'Help')
    const aboutIndex = buttons.findIndex((b) => b.textContent === 'About')
    expect(aboutIndex).toBe(helpIndex + 1)
    // Assert on the modal's own chrome, not its (user-editable) text content.
    const modalHeading = () => Array.from(document.querySelectorAll('h2')).find((h) => h.textContent === 'About')
    expect(modalHeading()).toBeUndefined()

    act(() => buttons[aboutIndex].click())
    expect(modalHeading()).toBeDefined()

    const close = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Close')!
    act(() => close.click())
    expect(modalHeading()).toBeUndefined()

    act(() => root.unmount())
    container.remove()
  })
})
