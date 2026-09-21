import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWalkthrough, type WalkthroughHandle } from '../src/lib/walkthrough'

// jsdom has no layout/scrolling; driver.js only needs these to exist.
Element.prototype.scrollIntoView = vi.fn()

describe('closing-step "Read the full help" link (real driver.js)', () => {
  let handle: WalkthroughHandle | undefined

  beforeEach(() => {
    document.body.innerHTML = '<div data-tour="dropzone">drop here</div>'
  })
  afterEach(() => {
    handle?.destroy()
    handle = undefined
    document.body.innerHTML = ''
  })

  it('ends the tour as completed and opens the written help when clicked', () => {
    const onEnd = vi.fn()
    const onOpenHelp = vi.fn()
    handle = runWalkthrough('landing', onEnd, { onOpenHelp })

    const link = document.querySelector<HTMLButtonElement>('[data-open-help]')
    expect(link).not.toBeNull()
    link!.click()

    expect(onOpenHelp).toHaveBeenCalledOnce()
    expect(onEnd).toHaveBeenCalledExactlyOnceWith('completed')
    expect(document.querySelector('.driver-popover')).toBeNull()
  })

  it('leaves the link out entirely when there is no help to open', () => {
    handle = runWalkthrough('landing', vi.fn())
    expect(document.querySelector('.driver-popover')).not.toBeNull()
    expect(document.querySelector('[data-open-help]')).toBeNull()
  })
})
