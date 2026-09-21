import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppFooter } from '../src/components/AppFooter'
import { useTheme } from '../src/hooks/useTheme'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness() {
  const { isDark, toggle } = useTheme()
  return <AppFooter isDark={isDark} onToggleTheme={toggle} />
}

function mount() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(<Harness />))
  const sw = container.querySelector('[role="switch"]') as HTMLButtonElement
  return { sw, unmount: () => act(() => root.unmount()) }
}

describe('theme switch', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark', 'theme-fading')
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('starts light with no saved choice, and toggles <html>.dark + aria-checked + storage', () => {
    const { sw, unmount } = mount()
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => sw.click())
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('stylemash-theme')).toBe('dark')

    act(() => sw.click())
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('stylemash-theme')).toBe('light')
    unmount()
  })

  it('restores a saved dark choice on mount', () => {
    localStorage.setItem('stylemash-theme', 'dark')
    const { sw, unmount } = mount()
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    unmount()
  })
})
