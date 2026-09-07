import type { RepoGlyph } from '../../fleet/gen/glyph-types.mts'

const GLYPH_PARTS = [
  {
    paths: [
      'M6.2 3.6 14.6 12 6.2 20.4 3.4 17.6 9 12 3.4 6.4Z',
      'M12 17.4H20.6V20.4H12Z',
    ],
  },
] satisfies RepoGlyph['parts']

export const REPO_GLYPH = {
  label: 'Socket CLI',
  parts: GLYPH_PARTS,
  source: 'A terminal prompt chevron and cursor bar.',
  viewBox: '0 0 24 24',
} satisfies RepoGlyph
