import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MULTI_SELECT_KEY } from '../src/lib/platform'
import {
  LANDING_STEPS,
  WORKSPACE_STEPS,
  hasSeenWalkthrough,
  recordWalkthroughEnd,
} from '../src/lib/walkthrough'

describe('walkthrough steps', () => {
  const allSteps = [...LANDING_STEPS, ...WORKSPACE_STEPS]

  it('stays short: a one-step intro plus four workspace steps', () => {
    expect(LANDING_STEPS).toHaveLength(1)
    expect(WORKSPACE_STEPS).toHaveLength(4)
  })

  it('every step has a unique title, a description, and a data-tour target', () => {
    const titles = allSteps.map((s) => s.popover?.title)
    expect(new Set(titles).size).toBe(allSteps.length)
    for (const step of allSteps) {
      expect(step.popover?.description).toBeTruthy()
      expect(step.element).toMatch(/^\[data-tour="[a-z-]+"\]$/)
    }
  })

  it('every data-tour target actually exists in a component', () => {
    const dir = join(__dirname, '..', 'src', 'components')
    const source = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n')
    for (const step of allSteps) {
      const name = /data-tour="([a-z-]+)"/.exec(String(step.element))![1]
      expect(source, `no element carries data-tour="${name}"`).toContain(`data-tour="${name}"`)
    }
  })

  it('the preview step names the platform multi-select key', () => {
    expect(WORKSPACE_STEPS[0].popover?.description).toContain(MULTI_SELECT_KEY)
  })
})

describe('walkthrough persistence', () => {
  beforeEach(() => localStorage.clear())

  it('starts unseen', () => {
    expect(hasSeenWalkthrough('landing')).toBe(false)
    expect(hasSeenWalkthrough('workspace')).toBe(false)
  })

  it('finishing the intro marks only the intro', () => {
    recordWalkthroughEnd('landing', 'completed')
    expect(hasSeenWalkthrough('landing')).toBe(true)
    expect(hasSeenWalkthrough('workspace')).toBe(false)
  })

  it('ending the workspace tour also marks the intro (it is torn down silently on file load)', () => {
    recordWalkthroughEnd('workspace', 'completed')
    expect(hasSeenWalkthrough('landing')).toBe(true)
    expect(hasSeenWalkthrough('workspace')).toBe(true)
  })

  it('skipping anywhere marks everything seen', () => {
    recordWalkthroughEnd('landing', 'skipped')
    expect(hasSeenWalkthrough('landing')).toBe(true)
    expect(hasSeenWalkthrough('workspace')).toBe(true)
  })
})
