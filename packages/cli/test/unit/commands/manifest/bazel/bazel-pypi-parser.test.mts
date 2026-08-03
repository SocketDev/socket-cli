/**
 * Unit tests for the PyPI extraction parsers: pinned lockfile lines, spoke
 * tags, alias resolution, reached-label filtering, and name normalization.
 */

import { describe, expect, it } from 'vitest'

import {
  bazelNameToPypiName,
  collectPypiPackages,
  filterReachedPypiPackages,
  normalizePypiName,
  parseAliasActualFromBuildOutput,
  parsePypiTagsFromBuildOutput,
  parseRequirementsLock,
  resolveRequirementsLockPath,
} from '../../../../../src/commands/manifest/bazel/bazel-pypi-parser.mts'

describe('parseRequirementsLock', () => {
  it('parses canonical name==version lines', () => {
    const text = 'requests==2.33.1\nnumpy==2.4.4\n'
    const result = parseRequirementsLock(text)
    expect(result.size).toBe(2)
    expect(result.get('requests')).toEqual({
      bazelName: 'requests',
      name: 'requests',
      originalLine: 'requests==2.33.1',
      source: 'lockfile',
      version: '2.33.1',
    })
  })

  it('skips comments, empty lines, hash continuations, options', () => {
    const text = `
# comment
requests==2.33.1
--hash=sha256:abcd
--index-url https://pypi.org/simple
-e git+https://github.com/foo/bar
-r other.txt
https://example.com/pkg.tar.gz
    `.trim()
    const result = parseRequirementsLock(text)
    expect(result.size).toBe(1)
    expect(result.has('requests')).toBe(true)
  })

  it('normalizes underscores, dots, and hyphens for membership keys', () => {
    const text =
      'charset_normalizer==3.4.7\ntyping-extensions==4.15.0\nSome.Package==1.0.0\n'
    const result = parseRequirementsLock(text)
    expect(result.get('charset-normalizer')).toBeDefined()
    expect(result.get('typing-extensions')).toBeDefined()
    expect(result.get('some-package')).toBeDefined()
  })

  it('handles trailing backslash continuation', () => {
    const text = 'requests==2.33.1 \\\n  --hash=sha256:abc\nnumpy==2.4.4\n'
    const result = parseRequirementsLock(text)
    expect(result.size).toBe(2)
    expect(result.has('requests')).toBe(true)
    expect(result.has('numpy')).toBe(true)
  })

  it('returns empty map for empty input', () => {
    expect(parseRequirementsLock('').size).toBe(0)
  })

  it('ignores mixed valid and invalid lines', () => {
    const text = 'a==1.0.0\nfoo>=1.0\nbar==2.0.0\n'
    const result = parseRequirementsLock(text)
    expect(result.size).toBe(2)
    expect(result.has('a')).toBe(true)
    expect(result.has('bar')).toBe(true)
    expect(result.has('foo')).toBe(false)
  })

  it('preserves safe originalLine spelling', () => {
    const text = 'Foo-Bar==1.0.0\n'
    const result = parseRequirementsLock(text)
    expect(result.get('foo-bar')).toEqual(
      expect.objectContaining({
        bazelName: 'Foo_Bar',
        name: 'Foo-Bar',
      }),
    )
  })

  it('rejects conflicting duplicate normalized names with original lines', () => {
    const text = 'foo-bar==1.0.0\nFoo_Bar==2.0.0\n'
    expect(() => parseRequirementsLock(text)).toThrow(
      /foo-bar==1\.0\.0 conflicts with Foo_Bar==2\.0\.0/,
    )
  })

  it('keeps the first duplicate normalized name when the version matches', () => {
    const result = parseRequirementsLock('foo-bar==1.0.0\nFoo_Bar==1.0.0\n')
    expect(result.size).toBe(1)
    expect(result.get('foo-bar')?.originalLine).toBe('foo-bar==1.0.0')
  })
})

describe('parseAliasActualFromBuildOutput', () => {
  it('extracts double-quoted alias actual labels', () => {
    expect(
      parseAliasActualFromBuildOutput(
        'alias(name = "pkg", actual = "@pypi_requests//:pkg")',
      ),
    ).toBe('@pypi_requests//:pkg')
  })

  it('extracts single-quoted alias actual labels', () => {
    expect(
      parseAliasActualFromBuildOutput(
        "alias(name = 'pkg', actual = '@pypi_requests//:pkg')",
      ),
    ).toBe('@pypi_requests//:pkg')
  })

  it('extracts canonical Bzlmod alias actual labels', () => {
    expect(
      parseAliasActualFromBuildOutput(
        'alias(name = "pkg", actual = "@@rules_python~~pip~pypi_312_requests//:pkg")',
      ),
    ).toBe('@@rules_python~~pip~pypi_312_requests//:pkg')
  })

  it('returns undefined when no alias actual is present', () => {
    expect(
      parseAliasActualFromBuildOutput('py_library(name = "pkg")'),
    ).toBeUndefined()
  })
})

describe('parsePypiTagsFromBuildOutput', () => {
  it('extracts pypi_name and pypi_version from tags', () => {
    const text = 'tags = ["pypi_name=requests", "pypi_version=2.33.1"]'
    const result = parsePypiTagsFromBuildOutput(text)
    expect(result).toEqual({
      bazelName: 'requests',
      name: 'requests',
      source: 'spoke-tag',
      version: '2.33.1',
    })
  })

  it('returns undefined when pypi_name is missing', () => {
    const text = 'tags = ["pypi_version=2.33.1"]'
    expect(parsePypiTagsFromBuildOutput(text)).toBeUndefined()
  })

  it('returns undefined when pypi_version is missing', () => {
    const text = 'tags = ["pypi_name=requests"]'
    expect(parsePypiTagsFromBuildOutput(text)).toBeUndefined()
  })

  it('handles extra whitespace around tags', () => {
    const text =
      'tags = [  "pypi_name= charset-normalizer" ,  "pypi_version= 3.4.7" ]'
    const result = parsePypiTagsFromBuildOutput(text)
    expect(result).toBeDefined()
    expect(result?.name).toBe('charset-normalizer')
  })

  it('extracts one-character package names from tags', () => {
    const text = 'tags = ["pypi_name=x", "pypi_version=1.0.0"]'
    const result = parsePypiTagsFromBuildOutput(text)
    expect(result).toEqual({
      bazelName: 'x',
      name: 'x',
      source: 'spoke-tag',
      version: '1.0.0',
    })
  })
})

describe('filterReachedPypiPackages', () => {
  it('extracts @pypi//name:pkg labels', () => {
    const text = '@pypi//requests:pkg\n@pypi//numpy:pkg\n//local:target\n'
    const result = filterReachedPypiPackages(text, 'pypi')
    expect(result.length).toBe(2)
    expect(result[0]).toEqual({
      apparentLabel: '@pypi//requests:pkg',
      bazelName: 'requests',
      hubName: 'pypi',
      normalizedName: 'requests',
      originalLabel: '@pypi//requests:pkg',
    })
  })

  it('ignores non-hub labels', () => {
    const text = '//some:local\n@other//thing:pkg\n'
    expect(filterReachedPypiPackages(text, 'pypi')).toEqual([])
  })

  it('handles multiple hubs', () => {
    const text = '@pypi//a:pkg\n@my_pip//b:pkg\n'
    expect(filterReachedPypiPackages(text, 'pypi').length).toBe(1)
    expect(filterReachedPypiPackages(text, 'my_pip').length).toBe(1)
  })

  it('returns empty on empty query output', () => {
    expect(filterReachedPypiPackages('', 'pypi')).toEqual([])
  })

  it('keeps duplicate normalized names for conflict detection', () => {
    const text = '@pypi//Foo_Bar:pkg\n@pypi//foo-bar:pkg\n'
    const result = filterReachedPypiPackages(text, 'pypi')
    expect(result.length).toBe(2)
  })
})

describe('bazelNameToPypiName', () => {
  it('converts underscores to hyphens', () => {
    expect(bazelNameToPypiName('charset_normalizer')).toBe('charset-normalizer')
    expect(bazelNameToPypiName('typing_extensions')).toBe('typing-extensions')
  })

  it('leaves already-hyphenated names unchanged', () => {
    expect(bazelNameToPypiName('some-package')).toBe('some-package')
  })

  it('leaves names without underscores unchanged', () => {
    expect(bazelNameToPypiName('requests')).toBe('requests')
  })
})

describe('normalizePypiName', () => {
  it('lowercases and collapses dots, underscores, hyphens', () => {
    expect(normalizePypiName('Foo.Bar_Baz-Qux')).toBe('foo-bar-baz-qux')
  })

  it('handles PEP 503 case-insensitive comparison', () => {
    expect(normalizePypiName('Requests')).toBe('requests')
    expect(normalizePypiName('NumPy')).toBe('numpy')
  })
})

describe('resolveRequirementsLockPath', () => {
  const cwd = '/workspace'

  it('resolves //:requirements_lock.txt to cwd/requirements_lock.txt', () => {
    expect(resolveRequirementsLockPath('//:requirements_lock.txt', cwd)).toBe(
      '/workspace/requirements_lock.txt',
    )
  })

  it('resolves :requirements_lock.txt to cwd/requirements_lock.txt', () => {
    expect(resolveRequirementsLockPath(':requirements_lock.txt', cwd)).toBe(
      '/workspace/requirements_lock.txt',
    )
  })

  it('resolves //subdir:requirements_lock.txt to cwd/subdir/requirements_lock.txt', () => {
    expect(
      resolveRequirementsLockPath('//subdir:requirements_lock.txt', cwd),
    ).toBe('/workspace/subdir/requirements_lock.txt')
  })

  it('resolves workspace-relative paths', () => {
    expect(resolveRequirementsLockPath('reqs.txt', cwd)).toBe(
      '/workspace/reqs.txt',
    )
  })

  it('rejects paths containing ..', () => {
    expect(
      resolveRequirementsLockPath('//foo/../etc:pass', cwd),
    ).toBeUndefined()
  })

  it('rejects absolute paths', () => {
    expect(resolveRequirementsLockPath('/etc/passwd', cwd)).toBeUndefined()
  })

  it('rejects external repo labels', () => {
    expect(resolveRequirementsLockPath('@repo//path:file', cwd)).toBeUndefined()
  })

  it('returns undefined for undefined label', () => {
    expect(resolveRequirementsLockPath(undefined, cwd)).toBeUndefined()
  })
})

describe('collectPypiPackages', () => {
  it('collects lockfile versions when available', () => {
    const lockfile = new Map([
      [
        'requests',
        {
          bazelName: 'requests',
          name: 'requests',
          source: 'lockfile' as const,
          version: '2.33.1',
        },
      ],
    ])
    const reached = [
      {
        apparentLabel: '@pypi//requests:pkg',
        bazelName: 'requests',
        hubName: 'pypi',
        normalizedName: 'requests',
        originalLabel: '@pypi//requests:pkg',
      },
    ]
    const result = collectPypiPackages(reached, lockfile, undefined)
    expect(result).toEqual([
      {
        label: '@pypi//requests:pkg',
        name: 'requests',
        source: 'lockfile',
        version: '2.33.1',
      },
    ])
  })

  it('falls back to spoke tags when lockfile missing', () => {
    const spoke = new Map([
      [
        'numpy',
        {
          bazelName: 'numpy',
          name: 'numpy',
          source: 'spoke-tag' as const,
          version: '2.4.4',
        },
      ],
    ])
    const reached = [
      {
        apparentLabel: '@pypi//numpy:pkg',
        bazelName: 'numpy',
        hubName: 'pypi',
        normalizedName: 'numpy',
        originalLabel: '@pypi//numpy:pkg',
      },
    ]
    const result = collectPypiPackages(reached, undefined, spoke)
    expect(result).toEqual([
      {
        label: '@pypi//numpy:pkg',
        name: 'numpy',
        source: 'spoke-tag',
        version: '2.4.4',
      },
    ])
  })

  it('dedups duplicate normalized names with the same version', () => {
    const lockfile = new Map([
      [
        'foo',
        {
          bazelName: 'foo',
          name: 'foo',
          source: 'lockfile' as const,
          version: '1.0.0',
        },
      ],
    ])
    const reached = [
      {
        apparentLabel: '@pypi//foo:pkg',
        bazelName: 'foo',
        hubName: 'pypi',
        normalizedName: 'foo',
        originalLabel: '@pypi//foo:pkg',
      },
      {
        apparentLabel: '@other//Foo:pkg',
        bazelName: 'Foo',
        hubName: 'other',
        normalizedName: 'foo',
        originalLabel: '@other//Foo:pkg',
      },
    ]
    const result = collectPypiPackages(reached, lockfile, undefined)
    expect(result.length).toBe(1)
    expect(result[0]).toEqual({
      label: '@pypi//foo:pkg',
      name: 'foo',
      source: 'lockfile',
      version: '1.0.0',
    })
  })

  it('throws when no version source is available', () => {
    const reached = [
      {
        apparentLabel: '@pypi//missing:pkg',
        bazelName: 'missing',
        hubName: 'pypi',
        normalizedName: 'missing',
        originalLabel: '@pypi//missing:pkg',
      },
    ]
    expect(() => collectPypiPackages(reached, undefined, undefined)).toThrow(
      /No version found/,
    )
  })
})
