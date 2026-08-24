import { describe, expect, it } from 'vitest'

import { writeManifestVersion } from '../scripts/release/bump.mts'

describe('writeManifestVersion', () => {
  it('rewrites the top-level version field, leaving everything else byte-for-byte', () => {
    const raw = [
      '{',
      '  "name": "socket",',
      '  "version": "1.1.159",',
      '  "description": "CLI for Socket.dev"',
      '}',
      '',
    ].join('\n')
    expect(writeManifestVersion(raw, '1.1.160')).toBe(
      raw.replace('1.1.159', '1.1.160'),
    )
  })

  // The prior `^(\s*"version":\s*")[^"]*(")/m` anchor required the field to
  // start a line. A minified (or otherwise reformatted) manifest still
  // parses fine with JSON.parse, but broke that anchor and threw a false
  // "no top-level version line" error — this is the exact failure this repo
  // has hit intermittently on CI. The unanchored, non-multiline pattern
  // matches the first "version": "…" occurrence regardless of surrounding
  // whitespace.
  it('rewrites the version field even when the manifest is minified', () => {
    const raw = '{"name":"socket","version":"1.1.159","private":false}'
    expect(writeManifestVersion(raw, '1.1.160')).toBe(
      '{"name":"socket","version":"1.1.160","private":false}',
    )
  })

  it('throws when the manifest has no version field', () => {
    const raw = '{\n  "name": "socket"\n}\n'
    expect(() => writeManifestVersion(raw, '1.1.160')).toThrow(
      /could not rewrite the package\.json version field/,
    )
  })

  it('throws when the version field is already empty', () => {
    const raw = '{\n  "name": "socket",\n  "version": ""\n}\n'
    expect(() => writeManifestVersion(raw, '1.1.160')).toThrow(
      /could not rewrite the package\.json version field/,
    )
  })
})
