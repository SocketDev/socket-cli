import { describe, expect, it } from 'vitest'

import {
  createConfigGlobFilter,
  globToRegexSource,
  serializeConfigPatterns,
} from './config-glob.mts'

// Vector table for the cross-language config-glob contract. The globs are
// compiled to regex pattern sources here (the ONLY implementation) and handed
// pre-compiled to the gradle init script, the sbt plugin, the maven extension,
// and the dotnet tool — so these vectors define the semantics every producer
// sees. The emitted subset must behave identically in JS RegExp, Java
// java.util.regex, and .NET Regex.
const MATCH_VECTORS: Array<{
  glob: string
  matches: string[]
  rejects: string[]
}> = [
  // Literals are exact, case-SENSITIVE matches.
  {
    glob: 'compileClasspath',
    matches: ['compileClasspath'],
    rejects: ['CompileClasspath', 'compileClasspathX', 'xcompileClasspath'],
  },
  // `*` spans any run of characters, including none.
  {
    glob: '*CompileClasspath',
    matches: ['CompileClasspath', 'testCompileClasspath'],
    rejects: ['compileClasspath', 'CompileClasspathTest'],
  },
  {
    glob: 'net*',
    matches: ['net8.0', 'netstandard2.0', 'net'],
    rejects: ['dotnet8.0'],
  },
  // `?` matches exactly one character.
  {
    glob: 'net?.0',
    matches: ['net8.0', 'net9.0'],
    rejects: ['net10.0', 'net.0'],
  },
  // Character classes: enumerations, ranges, and `[!..]`/`[^..]` negation.
  {
    glob: '[cC]ompile',
    matches: ['compile', 'Compile'],
    rejects: ['dompile'],
  },
  {
    glob: 'net[6-8].0',
    matches: ['net6.0', 'net7.0', 'net8.0'],
    rejects: ['net9.0'],
  },
  {
    glob: '[!t]est',
    matches: ['best', 'rest'],
    rejects: ['test'],
  },
  {
    glob: '[^t]est',
    matches: ['best', 'rest'],
    rejects: ['test'],
  },
  // Regex metacharacters in globs are literals.
  {
    glob: 'net8.0',
    matches: ['net8.0'],
    rejects: ['net8x0'],
  },
  {
    glob: 'a+b(c)|d',
    matches: ['a+b(c)|d'],
    rejects: ['aab(c)|d'],
  },
  // An unterminated `[` is a literal bracket.
  {
    glob: 'a[bc',
    matches: ['a[bc'],
    rejects: ['ab', 'ac'],
  },
  // An empty (possibly negated) class would emit `[^]` — valid in JS but
  // rejected by Java/.NET — so the whole glob falls back to a literal match,
  // the same behavior the per-language implementations had.
  {
    glob: '[!]est',
    matches: ['[!]est'],
    rejects: ['best', 'test', 'est'],
  },
  {
    glob: '[^]est',
    matches: ['[^]est'],
    rejects: ['best', 'est'],
  },
  // `&` inside a class is a literal (Java classes support `&&` intersection;
  // the emitted pattern escapes it so all three engines agree).
  {
    glob: '[a&]x',
    matches: ['ax', '&x'],
    rejects: ['bx'],
  },
]

describe('config-glob vectors (cross-language contract)', () => {
  for (const { glob, matches, rejects } of MATCH_VECTORS) {
    it(`\`${glob}\``, () => {
      const filter = createConfigGlobFilter(glob, '')
      for (const name of matches) {
        expect(filter(name), `${glob} should match ${name}`).toBe(true)
      }
      for (const name of rejects) {
        expect(filter(name), `${glob} should reject ${name}`).toBe(false)
      }
    })
  }
})

describe('include/exclude semantics', () => {
  it('no includes means everything; excludes always win', () => {
    const filter = createConfigGlobFilter('', '*test*')
    expect(filter('compileClasspath')).toBe(true)
    expect(filter('Test')).toBe(true)
    expect(filter('testCompileClasspath')).toBe(false)
    expect(filter('integrationtestRuntime')).toBe(false)
  })

  it('excludes apply after includes', () => {
    const filter = createConfigGlobFilter('*Classpath', '*test*')
    expect(filter('compileClasspath')).toBe(true)
    expect(filter('integrationtestClasspath')).toBe(false)
    expect(filter('compile')).toBe(false)
  })

  it('comma-separated patterns OR together', () => {
    const filter = createConfigGlobFilter('compile, runtime', '')
    expect(filter('compile')).toBe(true)
    expect(filter('runtime')).toBe(true)
    expect(filter('test')).toBe(false)
  })
})

describe('emitted pattern sources (transport format)', () => {
  it('anchors patterns so unanchored matchers still test the full name', () => {
    expect(globToRegexSource('net*')).toBe('^(?:net.*)$')
    expect(globToRegexSource('a?b')).toBe('^(?:a.b)$')
  })

  it('escapes regex metacharacters as literals', () => {
    expect(globToRegexSource('net8.0')).toBe('^(?:net8\\.0)$')
    expect(globToRegexSource('a+b(c)|d')).toBe('^(?:a\\+b\\(c\\)\\|d)$')
    expect(globToRegexSource('a{b}')).toBe('^(?:a\\{b\\})$')
  })

  it('escapes `&` in class bodies (Java `&&` intersection guard)', () => {
    expect(globToRegexSource('[a&]x')).toBe('^(?:[a\\&]x)$')
  })

  it('normalizes `[!..]` negation to `[^..]`', () => {
    expect(globToRegexSource('[!t]est')).toBe('^(?:[^t]est)$')
  })

  it('never emits `[^]` (Java/.NET-invalid); empty classes go literal', () => {
    expect(globToRegexSource('[!]est')).toBe('^(?:\\[!\\]est)$')
    expect(globToRegexSource('[^]')).toBe('^(?:\\[\\^\\])$')
  })

  it('emits nothing a comma-join could break on', () => {
    // The transport comma-joins patterns; globs cannot contain commas (the
    // comma-split precedes glob parsing), so emitted patterns cannot either.
    const serialized = serializeConfigPatterns('net*, [a&]x ,a+b(c)|d')
    expect(serialized).toBe('^(?:net.*)$,^(?:[a\\&]x)$,^(?:a\\+b\\(c\\)\\|d)$')
    for (const pattern of serialized.split(',')) {
      expect(() => new RegExp(pattern)).not.toThrow()
    }
  })

  it('serializes empty/blank input to the empty string', () => {
    expect(serializeConfigPatterns('')).toBe('')
    expect(serializeConfigPatterns(' , ,')).toBe('')
    expect(serializeConfigPatterns(undefined)).toBe('')
  })
})
