import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { AppHeader } from '../src/components/AppHeader'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AppHeader Walkthrough button', () => {
  it('calls onWalkthrough (starts the tour) when clicked', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onWalkthrough = vi.fn()
    act(() =>
      root.render(
        <AppHeader filename={null} isCustomizeOpen={false} onToggleCustomize={() => {}} onWalkthrough={onWalkthrough} />,
      ),
    )
    const walkthrough = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Walkthrough',
    )!
    act(() => walkthrough.click())
    expect(onWalkthrough).toHaveBeenCalledOnce()
    act(() => root.unmount())
    container.remove()
  })

  it('has an About button, to the right of Walkthrough, that opens and closes the About modal', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        <AppHeader filename={null} isCustomizeOpen={false} onToggleCustomize={() => {}} onWalkthrough={() => {}} />,
      ),
    )
    const buttons = Array.from(container.querySelectorAll('button'))
    const walkthroughIndex = buttons.findIndex((b) => b.textContent === 'Walkthrough')
    const aboutIndex = buttons.findIndex((b) => b.textContent === 'About')
    expect(aboutIndex).toBe(walkthroughIndex + 1)
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
