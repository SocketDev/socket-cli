import { describe, expect, it } from 'vitest'

import { parsePackageSpecifiers } from './parse-package-specifiers.mts'

describe('parse-package-specifiers', async () => {
  it('should parse a simple `npm babel`', () => {
    const { purls, valid } = parsePackageSpecifiers('npm', ['babel'])
    expect(valid).toBe(true)
    expect(purls).toStrictEqual(['pkg:npm/babel'])
  })

  it('should parse a simple purl with prefix', () => {
    expect(parsePackageSpecifiers('pkg:npm/babel', [])).toMatchInlineSnapshot(`
      {
        "purls": [
          "pkg:npm/babel",
        ],
        "valid": true,
      }
    `)
  })

  it('should support npm scoped packages', () => {
    expect(
      parsePackageSpecifiers('npm', ['@babel/core']),
    ).toMatchInlineSnapshot(`
      {
        "purls": [
          "pkg:npm/@babel/core",
        ],
        "valid": true,
      }
    `)
  })

  it('should parse a simple purl without prefix', () => {
    expect(parsePackageSpecifiers('npm/babel', [])).toMatchInlineSnapshot(`
      {
        "purls": [
          "pkg:npm/babel",
        ],
        "valid": true,
      }
    `)
  })

  it('should parse a multiple purls', () => {
    expect(
      parsePackageSpecifiers('npm/babel', ['golang/foo']),
    ).toMatchInlineSnapshot(`
      {
        "purls": [
          "pkg:npm/babel",
          "pkg:golang/foo",
        ],
        "valid": true,
      }
    `)
  })

  it('should parse a mixed names and purls', () => {
    expect(
      parsePackageSpecifiers('npm', ['golang/foo', 'babel', 'pkg:npm/tenko']),
    ).toMatchInlineSnapshot(`
      {
        "purls": [
          "pkg:npm/golang/foo",
          "pkg:npm/babel",
          "pkg:npm/tenko",
        ],
        "valid": true,
      }
    `)
  })

  it('should complain when seeing an unscoped package without namespace', () => {
    expect(
      parsePackageSpecifiers('golang/foo', ['babel', 'pkg:npm/tenko']),
    ).toMatchInlineSnapshot(`
      {
        "purls": [
          "pkg:golang/foo",
        ],
        "valid": false,
      }
    `)
  })

  it('should complain when only getting a namespace', () => {
    expect(parsePackageSpecifiers('npm', [])).toMatchInlineSnapshot(`
      {
        "purls": [],
        "valid": false,
      }
    `)
  })

  it('should complain when getting an empty namespace', () => {
    expect(parsePackageSpecifiers('', [])).toMatchInlineSnapshot(`
      {
        "purls": [],
        "valid": false,
      }
    `)
  })
})
