import { describe, expect, it } from 'vitest'

import {
  PackageURL,
  createPurlObject,
  getPurlObject,
  normalizePurl,
} from '../../../src/utils/purl.mts'

describe('PURL compatibility', () => {
  it('preserves npm scoped names and creates purl objects', () => {
    const scoped = PackageURL.fromString('pkg:npm/%40scope/name@1.2.3')
    expect(scoped.toString()).toBe('pkg:npm/%40scope/name@1.2.3')
    expect(scoped.namespace).toBe('@scope')
    expect(scoped.name).toBe('name')

    const legacy = createPurlObject('npm', 'request')
    expect(legacy).toMatchObject({ type: 'npm', name: 'request' })
    expect(legacy.toString()).toBe('pkg:npm/request')
  })

  it('parses Maven and PyPI coordinates', () => {
    expect(
      PackageURL.fromString('pkg:maven/org.example/library@2.4').toString(),
    ).toBe('pkg:maven/org.example/library@2.4')
    expect(PackageURL.fromString('pkg:pypi/Django@5.0').toString()).toBe(
      'pkg:pypi/django@5.0',
    )
  })

  it('keeps plus signs in qualifier values and escapes them on serialization', () => {
    const parsed = PackageURL.fromString('pkg:npm/a?tag=a+b')
    expect(parsed.qualifiers?.tag).toBe('a+b')
    expect(parsed.toString()).toBe('pkg:npm/a?tag=a%2Bb')
  })

  it('normalizes dot segments in subpaths', () => {
    const parsed = PackageURL.fromString('pkg:npm/a#src/./lib/../index.js')
    expect(parsed.subpath).toBe('src/lib/index.js')
    expect(parsed.toString()).toBe('pkg:npm/a#src/lib/index.js')
  })

  it('rejects malformed encodings and supports no-throw parsing', () => {
    expect(() => PackageURL.fromString('pkg:npm/%ZZ')).toThrow(
      /unable to decode/,
    )
    expect(() => new PackageURL('npm', undefined, '')).toThrow(/name/)
    expect(() => getPurlObject('pkg:npm/%ZZ')).toThrow()
    expect(getPurlObject('pkg:npm/%ZZ', { throws: false })).toBeUndefined()
    expect(normalizePurl('npm/a')).toBe('pkg:npm/a')
  })
})
