import { describe, expect, it } from 'vitest'

import {
  createExcludePathFilter,
  excludePathGlobToRegexSource,
  serializeExcludePathPatterns,
} from './exclude-paths-glob.mts'

// Vector table for the cross-language --exclude-paths contract. Globs are
// compiled to regex pattern sources here (the ONLY implementation) and handed
// pre-compiled to the gradle/sbt/maven facts and workspaces scripts, so these
// vectors define the semantics every producer sees. Every entry means "this
// path AND its whole subtree", whether or not the user wrote a trailing
// `/**` themselves.
const MATCH_VECTORS: Array<{
  glob: string
  matches: string[]
  rejects: string[]
}> = [
  // A bare entry excludes itself and its whole subtree, without needing an
  // explicit trailing `/**`.
  {
    glob: 'legacy',
    matches: ['legacy', 'legacy/sub', 'legacy/sub/deeper'],
    rejects: ['legacyx', 'xlegacy', 'a/legacy'],
  },
  // An explicit trailing `/**` (or `/`) compiles to the identical pattern.
  {
    glob: 'legacy/**',
    matches: ['legacy', 'legacy/sub'],
    rejects: ['legacyx'],
  },
  {
    glob: 'legacy/',
    matches: ['legacy', 'legacy/sub'],
    rejects: ['legacyx'],
  },
  // `*` spans one path segment, never crossing `/`.
  {
    glob: 'leg*cy',
    matches: ['legacy', 'legcy'],
    rejects: ['leg/acy', 'legacyx'],
  },
  // `?` matches exactly one character, never `/`.
  {
    glob: 'a?c',
    matches: ['abc'],
    rejects: ['ac', 'a/c', 'abbc'],
  },
  // Leading `**/` matches at any depth, including root-level (the NIO
  // zero-depth gap this compiler exists to close without per-language
  // variant expansion).
  {
    glob: '**/legacy',
    matches: ['legacy', 'a/legacy', 'a/b/legacy', 'a/legacy/sub'],
    rejects: ['legacyx', 'a/legacyx'],
  },
  // A mid-pattern `**` spans zero or more whole segments.
  {
    glob: 'src/**/legacy',
    matches: ['src/legacy', 'src/a/legacy', 'src/a/b/legacy'],
    rejects: ['xsrc/legacy', 'src/legacyx', 'legacy'],
  },
  // Character classes: enumerations, ranges, and `[!..]`/`[^..]` negation.
  {
    glob: '[lL]egacy',
    matches: ['legacy', 'Legacy'],
    rejects: ['regacy'],
  },
  {
    glob: 'v[1-3]',
    matches: ['v1', 'v2', 'v3'],
    rejects: ['v4'],
  },
  {
    glob: '[!x]legacy',
    matches: ['ylegacy'],
    rejects: ['xlegacy'],
  },
  {
    glob: '[^x]legacy',
    matches: ['ylegacy'],
    rejects: ['xlegacy'],
  },
  // Regex metacharacters in globs are literals.
  {
    glob: 'a.b',
    matches: ['a.b'],
    rejects: ['axb'],
  },
  // An unterminated `[` is a literal bracket.
  {
    glob: 'a[bc',
    matches: ['a[bc'],
    rejects: ['ab', 'ac'],
  },
  // An empty (possibly negated) class would emit `[^]`, valid in JS but
  // rejected by Java - the whole glob falls back to a literal match.
  {
    glob: '[!]legacy',
    matches: ['[!]legacy'],
    rejects: ['xlegacy', 'legacy'],
  },
  // `&` inside a class is a literal (Java classes support `&&` intersection;
  // the emitted pattern escapes it so both engines agree).
  {
    glob: '[a&]x',
    matches: ['ax', '&x'],
    rejects: ['bx'],
  },
]

describe('exclude-paths-glob vectors (cross-language contract)', () => {
  for (const { glob, matches, rejects } of MATCH_VECTORS) {
    it(`\`${glob}\``, () => {
      const filter = createExcludePathFilter([glob])
      for (const relPath of matches) {
        expect(filter(relPath), `${glob} should match ${relPath}`).toBe(true)
      }
      for (const relPath of rejects) {
        expect(filter(relPath), `${glob} should reject ${relPath}`).toBe(false)
      }
    })
  }
})

describe('multiple entries', () => {
  it('matches if any entry matches', () => {
    const filter = createExcludePathFilter(['legacy', 'vendor'])
    expect(filter('legacy')).toBe(true)
    expect(filter('vendor/pkg')).toBe(true)
    expect(filter('src')).toBe(false)
  })

  it('an empty/undefined list matches nothing', () => {
    expect(createExcludePathFilter([])('legacy')).toBe(false)
    expect(createExcludePathFilter(undefined)('legacy')).toBe(false)
  })
})

describe('emitted pattern sources (transport format)', () => {
  it('wraps every entry in a self-or-subtree suffix', () => {
    expect(excludePathGlobToRegexSource('legacy')).toBe('^(?:legacy)(?:/.*)?$')
  })

  it('translates * and ? to segment-bounded classes', () => {
    expect(excludePathGlobToRegexSource('a*b')).toBe('^(?:a[^/]*b)(?:/.*)?$')
    expect(excludePathGlobToRegexSource('a?b')).toBe('^(?:a[^/]b)(?:/.*)?$')
  })

  it('translates a leading ** to zero-or-more full segments', () => {
    expect(excludePathGlobToRegexSource('**/legacy')).toBe(
      '^(?:(?:[^/]+/)*legacy)(?:/.*)?$',
    )
  })

  it('escapes regex metacharacters as literals', () => {
    expect(excludePathGlobToRegexSource('a.b')).toBe('^(?:a\\.b)(?:/.*)?$')
  })

  it('escapes `&` in class bodies (Java `&&` intersection guard)', () => {
    expect(excludePathGlobToRegexSource('[a&]x')).toBe('^(?:[a\\&]x)(?:/.*)?$')
  })

  it('normalizes `[!..]` negation to `[^..]`', () => {
    expect(excludePathGlobToRegexSource('[!x]legacy')).toBe(
      '^(?:[^x]legacy)(?:/.*)?$',
    )
  })

  it('never emits `[^]` (Java-invalid); empty classes go literal', () => {
    expect(excludePathGlobToRegexSource('[!]legacy')).toBe(
      '^(?:\\[!\\]legacy)(?:/.*)?$',
    )
  })

  it('emits nothing a comma-join could break on', () => {
    // The transport comma-joins patterns; globs cannot contain commas (the
    // comma-split precedes glob parsing), so emitted patterns cannot either.
    const serialized = serializeExcludePathPatterns(['legacy', '[a&]x'])
    for (const pattern of serialized.split(',')) {
      expect(() => new RegExp(pattern)).not.toThrow()
    }
  })

  it('serializes an empty/undefined list to the empty string', () => {
    expect(serializeExcludePathPatterns([])).toBe('')
    expect(serializeExcludePathPatterns(undefined)).toBe('')
  })
})
