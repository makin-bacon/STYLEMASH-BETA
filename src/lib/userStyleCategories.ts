import type { UserStyleRecord } from '../types/ooxml'

/** Presentation-only grouping for the "New Styles" panel, requested to mirror
 * the "Customise your own style file" checklist's category sections
 * (DefaultStylesChecklist) - but keyword-based rather than sourced from a
 * reference file's own section headings, since a UserStyleRecord (created ad
 * hoc via merges, "+ New Style", or "+ Defaults") has no category field of
 * its own to read. `Body/Miscellaneous` is the catch-all for anything that
 * doesn't match a keyword, and always renders first (per explicit
 * instruction) - Headings and Lists after it, in that order, matching the
 * Heading-before-List convention DefaultStyleCategory already uses. */
export type UserStyleCategory = 'Body/Miscellaneous' | 'Headings' | 'Lists'

export const USER_STYLE_CATEGORIES: UserStyleCategory[] = ['Body/Miscellaneous', 'Headings', 'Lists']

/** Categorizes a single style by name: case-insensitive substring match on
 * "heading" or "list" (matching Word's own naming convention - "Heading 1",
 * "List Bullet", "List Number 2", ...), checked in that order so a
 * hypothetical style whose name contains both would still land under
 * Headings. Anything matching neither falls into Body/Miscellaneous. */
export function categorizeUserStyle(name: string): UserStyleCategory {
  const lower = name.toLowerCase()
  if (lower.includes('heading')) return 'Headings'
  if (lower.includes('list')) return 'Lists'
  return 'Body/Miscellaneous'
}

/** Groups a full User-Created style list into USER_STYLE_CATEGORIES' three
 * buckets, preserving each style's relative order within its bucket. */
export function groupUserStylesByCategory(
  records: UserStyleRecord[],
): Map<UserStyleCategory, UserStyleRecord[]> {
  const groups = new Map<UserStyleCategory, UserStyleRecord[]>()
  for (const category of USER_STYLE_CATEGORIES) groups.set(category, [])
  for (const record of records) {
    groups.get(categorizeUserStyle(record.name))?.push(record)
  }
  return groups
}
