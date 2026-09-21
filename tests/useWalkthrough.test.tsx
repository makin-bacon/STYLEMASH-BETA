import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runWalkthrough = vi.fn()
vi.mock('../src/lib/walkthrough', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/walkthrough')>('../src/lib/walkthrough')
  return { ...actual, runWalkthrough: (...args: unknown[]) => runWalkthrough(...args) }
})

import { useWalkthrough } from '../src/hooks/useWalkthrough'
import { hasSeenWalkthrough, recordWalkthroughEnd } from '../src/lib/walkthrough'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Status = 'empty' | 'loading' | 'loaded' | 'error'

let restart: (() => void) | undefined

function Harness({ status }: { status: Status }) {
  restart = useWalkthrough(status).restartWalkthrough
  return null
}

function mount(status: Status) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<Harness status={status} />))
  return {
    setStatus: (s: Status) => act(() => root.render(<Harness status={s} />)),
    unmount: () => act(() => root.unmount()),
  }
}

describe('useWalkthrough', () => {
  let destroy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    destroy = vi.fn()
    runWalkthrough.mockReset()
    restart = undefined
    runWalkthrough.mockReturnValue({ destroy })
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('starts the intro on the upload screen after a short delay', () => {
    const m = mount('empty')
    expect(runWalkthrough).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(700))
    expect(runWalkthrough).toHaveBeenCalledOnce()
    expect(runWalkthrough.mock.calls[0][0]).toBe('landing')
    m.unmount()
  })

  it('starts the workspace tour once a document is loaded', () => {
    const m = mount('loaded')
    act(() => void vi.advanceTimersByTime(1000))
    expect(runWalkthrough.mock.calls[0][0]).toBe('workspace')
    m.unmount()
  })

  it('does nothing for a phase the user has already seen', () => {
    recordWalkthroughEnd('landing', 'completed')
    const m = mount('empty')
    act(() => void vi.advanceTimersByTime(2000))
    expect(runWalkthrough).not.toHaveBeenCalled()
    m.unmount()
  })

  it('?tour forces it to run even when already seen', () => {
    recordWalkthroughEnd('landing', 'skipped')
    window.history.replaceState(null, '', '/?tour')
    const m = mount('empty')
    act(() => void vi.advanceTimersByTime(700))
    expect(runWalkthrough).toHaveBeenCalledOnce()
    m.unmount()
  })

  it('tears the intro down (without recording it) when a file starts loading', () => {
    const m = mount('empty')
    act(() => void vi.advanceTimersByTime(700))
    m.setStatus('loading')
    expect(destroy).toHaveBeenCalled()
    expect(hasSeenWalkthrough('landing')).toBe(false)
    m.unmount()
  })

  it('records the outcome when the tour reports its end', () => {
    const m = mount('loaded')
    act(() => void vi.advanceTimersByTime(1000))
    const onEnd = runWalkthrough.mock.calls[0][1] as (reason: 'completed' | 'skipped') => void
    act(() => onEnd('skipped'))
    expect(hasSeenWalkthrough('workspace')).toBe(true)
    expect(hasSeenWalkthrough('landing')).toBe(true)
    m.unmount()
  })

  it('does not start if the screen changes before the delay elapses', () => {
    const m = mount('empty')
    m.setStatus('loading')
    act(() => void vi.advanceTimersByTime(2000))
    expect(runWalkthrough).not.toHaveBeenCalled()
    m.unmount()
  })

  it('restartWalkthrough (the Help button) replays the intro on the upload screen even if already seen', () => {
    recordWalkthroughEnd('landing', 'skipped')
    const m = mount('empty')
    act(() => void vi.advanceTimersByTime(2000))
    expect(runWalkthrough).not.toHaveBeenCalled()
    act(() => restart!())
    expect(runWalkthrough).toHaveBeenCalledOnce()
    expect(runWalkthrough.mock.calls[0][0]).toBe('landing')
    m.unmount()
  })

  it('restartWalkthrough replays the workspace tour once a document is open', () => {
    recordWalkthroughEnd('workspace', 'completed')
    const m = mount('loaded')
    act(() => restart!())
    expect(runWalkthrough.mock.calls[0][0]).toBe('workspace')
    m.unmount()
  })

  it('restarting replaces a tour that is already running rather than stacking a second', () => {
    const m = mount('loaded')
    act(() => void vi.advanceTimersByTime(1000))
    act(() => restart!())
    expect(runWalkthrough).toHaveBeenCalledTimes(2)
    expect(destroy).toHaveBeenCalled()
    m.unmount()
  })

  it('restartWalkthrough does nothing while a file is loading', () => {
    const m = mount('loading')
    act(() => restart!())
    expect(runWalkthrough).not.toHaveBeenCalled()
    m.unmount()
  })

  it('an upload error still gets the upload-screen intro', () => {
    const m = mount('error')
    act(() => void vi.advanceTimersByTime(700))
    expect(runWalkthrough.mock.calls[0][0]).toBe('landing')
    m.unmount()
  })
})
