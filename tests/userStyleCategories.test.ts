import { describe, expect, it } from 'vitest'
import {
  USER_STYLE_CATEGORIES,
  categorizeUserStyle,
  groupUserStylesByCategory,
} from '../src/lib/userStyleCategories'
import type { FormattingSignature, UserStyleRecord } from '../src/types/ooxml'

const SIGNATURE: FormattingSignature = {
  fontFamily: null,
  fontSizeHalfPt: 24,
  colorValue: 'auto',
  bold: false,
  italic: false,
  underline: null,
  strike: false,
}

function makeRecord(name: string): UserStyleRecord {
  return {
    styleId: name.replace(/\s+/g, ''),
    name,
    targetSignature: SIGNATURE,
    kind: 'character',
    listFormat: 'none',
    createdAt: 0,
  }
}

describe('categorizeUserStyle', () => {
  it('groups a name containing "Heading" (case-insensitive) under Headings', () => {
    expect(categorizeUserStyle('Heading 1')).toBe('Headings')
    expect(categorizeUserStyle('my heading style')).toBe('Headings')
  })

  it('groups a name containing "List" (case-insensitive) under Lists', () => {
    expect(categorizeUserStyle('List Bullet')).toBe('Lists')
    expect(categorizeUserStyle('numbered list')).toBe('Lists')
  })

  it('falls back to Body/Miscellaneous for anything else', () => {
    expect(categorizeUserStyle('Normal')).toBe('Body/Miscellaneous')
    expect(categorizeUserStyle('Caption')).toBe('Body/Miscellaneous')
  })

  it('prefers Headings when a name matches both keywords', () => {
    expect(categorizeUserStyle('Heading List')).toBe('Headings')
  })
})

describe('groupUserStylesByCategory', () => {
  it('places every record in exactly its own category, preserving relative order', () => {
    const records = [
      makeRecord('Normal'),
      makeRecord('Heading 1'),
      makeRecord('List Bullet'),
      makeRecord('Caption'),
      makeRecord('Heading 2'),
    ]
    const groups = groupUserStylesByCategory(records)

    expect(new Set(groups.keys())).toEqual(new Set(USER_STYLE_CATEGORIES))
    expect(groups.get('Body/Miscellaneous')?.map((r) => r.name)).toEqual(['Normal', 'Caption'])
    expect(groups.get('Headings')?.map((r) => r.name)).toEqual(['Heading 1', 'Heading 2'])
    expect(groups.get('Lists')?.map((r) => r.name)).toEqual(['List Bullet'])
  })

  it('lists Body/Miscellaneous first in USER_STYLE_CATEGORIES', () => {
    expect(USER_STYLE_CATEGORIES[0]).toBe('Body/Miscellaneous')
  })

  it('returns an empty array (not undefined) for a category with no matching records', () => {
    const groups = groupUserStylesByCategory([makeRecord('Normal')])
    expect(groups.get('Headings')).toEqual([])
    expect(groups.get('Lists')).toEqual([])
  })
})
