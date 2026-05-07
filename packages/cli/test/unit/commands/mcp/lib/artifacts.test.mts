/**
 * Unit tests for the MCP command's artifact deduplicator.
 *
 * Tests deduplicateArtifacts(artifacts, platform?) — collapses
 * multiple build artifacts of the same package (different wheels,
 * platform binaries) into one representative per (type, namespace,
 * name, version) tuple. Uses a priority cascade:
 *   1. Platform-matching artifact (when `platform` hint is given)
 *   2. Source distribution
 *   3. Universal wheel
 *   4. First artifact in the group
 *
 * Test Coverage:
 * - Single-artifact groups pass through untouched
 * - Multiple artifacts of the same package collapse to one
 * - Different packages stay separate (group key includes type/ns/name/version)
 * - Platform hint selects the matching artifact across all six pairs
 *   (darwin-{arm64,x64}, linux-{arm64,x64}, win32-{ia32,x64}) plus
 *   substring fallback for unknown platforms
 * - Source distribution preferred when no platform hint
 * - Universal wheel preferred when no sdist
 * - First artifact wins as final fallback
 * - Missing namespace handled (key uses empty string)
 * - Empty input returns empty output
 *
 * Related Files:
 * - src/commands/mcp/lib/artifacts.mts - Implementation
 * - src/commands/mcp/depscore.mts - Caller (NDJSON response dedup)
 */

import { describe, expect, it } from 'vitest'

import { deduplicateArtifacts } from '../../../../../src/commands/mcp/lib/artifacts.mts'

import type { ArtifactData } from '../../../../../src/commands/mcp/lib/artifacts.mts'

function art(overrides: Partial<ArtifactData>): ArtifactData {
  return {
    name: 'foo',
    type: 'pypi',
    version: '1.0.0',
    ...overrides,
  } as ArtifactData
}

describe('deduplicateArtifacts', () => {
  describe('basic grouping', () => {
    it('returns empty array for empty input', () => {
      expect(deduplicateArtifacts([])).toEqual([])
    })

    it('passes a single artifact through untouched', () => {
      const a = art({ release: 'foo-1.0.0.tar.gz' })
      expect(deduplicateArtifacts([a])).toEqual([a])
    })

    it('keeps distinct packages separate', () => {
      const a = art({ name: 'foo' })
      const b = art({ name: 'bar' })
      const result = deduplicateArtifacts([a, b])
      expect(result).toHaveLength(2)
      expect(result.map(r => r.name).sort()).toEqual(['bar', 'foo'])
    })

    it('groups artifacts that share (type, namespace, name, version)', () => {
      const wheel1 = art({ release: 'foo-1.0.0-cp310-manylinux_x86_64.whl' })
      const wheel2 = art({ release: 'foo-1.0.0-cp310-macosx_arm64.whl' })
      const result = deduplicateArtifacts([wheel1, wheel2])
      expect(result).toHaveLength(1)
    })

    it('treats different versions as different groups', () => {
      const v1 = art({ version: '1.0.0' })
      const v2 = art({ version: '2.0.0' })
      expect(deduplicateArtifacts([v1, v2])).toHaveLength(2)
    })

    it('uses empty namespace in the group key when missing', () => {
      const a = art({ namespace: undefined })
      const b = art({ namespace: undefined })
      expect(deduplicateArtifacts([a, b])).toHaveLength(1)
    })

    it('treats different namespaces as different groups', () => {
      const a = art({ namespace: 'org1' })
      const b = art({ namespace: 'org2' })
      expect(deduplicateArtifacts([a, b])).toHaveLength(2)
    })

    it('uses empty-string fallbacks for missing type/name/version in the group key', () => {
      // Artifacts missing type/name/version still get grouped: empty
      // type + empty name + empty version + empty namespace == same key.
      // Two such artifacts collapse to one.
      const a = art({
        name: undefined,
        type: undefined,
        version: undefined,
      })
      const b = art({
        name: undefined,
        type: undefined,
        version: undefined,
      })
      expect(deduplicateArtifacts([a, b])).toHaveLength(1)
    })
  })

  describe('platform hint matching', () => {
    it('selects the macosx-arm64 wheel for darwin-arm64', () => {
      const linux = art({ release: 'foo-1.0.0-manylinux_x86_64.whl' })
      const macarm = art({ release: 'foo-1.0.0-macosx_arm64.whl' })
      const macx64 = art({ release: 'foo-1.0.0-macosx_x86_64.whl' })
      const [picked] = deduplicateArtifacts(
        [linux, macarm, macx64],
        'darwin-arm64',
      )
      expect(picked).toBe(macarm)
    })

    it('selects the macosx-x86_64 wheel for darwin-x64', () => {
      const linux = art({ release: 'foo-1.0.0-manylinux_x86_64.whl' })
      const macarm = art({ release: 'foo-1.0.0-macosx_arm64.whl' })
      const macx64 = art({ release: 'foo-1.0.0-macosx_x86_64.whl' })
      const [picked] = deduplicateArtifacts(
        [linux, macarm, macx64],
        'darwin-x64',
      )
      expect(picked).toBe(macx64)
    })

    it('selects manylinux x86_64 for linux-x64', () => {
      const win = art({ release: 'foo-1.0.0-win_amd64.whl' })
      const linux = art({ release: 'foo-1.0.0-manylinux_x86_64.whl' })
      const [picked] = deduplicateArtifacts([win, linux], 'linux-x64')
      expect(picked).toBe(linux)
    })

    it('selects aarch64 wheel for linux-arm64', () => {
      const x86 = art({ release: 'foo-1.0.0-manylinux_x86_64.whl' })
      const arm = art({ release: 'foo-1.0.0-manylinux_aarch64.whl' })
      const [picked] = deduplicateArtifacts([x86, arm], 'linux-arm64')
      expect(picked).toBe(arm)
    })

    it('selects amd64 wheel for win32-x64', () => {
      const win32 = art({ release: 'foo-1.0.0-win32.whl' })
      const win64 = art({ release: 'foo-1.0.0-win_amd64.whl' })
      const [picked] = deduplicateArtifacts([win32, win64], 'win32-x64')
      expect(picked).toBe(win64)
    })

    it('selects win32 wheel for win32-ia32', () => {
      const win32 = art({ release: 'foo-1.0.0-win32.whl' })
      const win64 = art({ release: 'foo-1.0.0-win_amd64.whl' })
      const [picked] = deduplicateArtifacts([win32, win64], 'win32-ia32')
      expect(picked).toBe(win32)
    })

    it('falls back to substring match for unknown platforms', () => {
      const a = art({ release: 'foo-1.0.0-freebsd.whl' })
      const b = art({ release: 'foo-1.0.0-linux.whl' })
      const [picked] = deduplicateArtifacts([a, b], 'freebsd')
      expect(picked).toBe(a)
    })

    it('falls back to next priority when platform has no match', () => {
      const sdist = art({ release: 'foo-1.0.0.tar.gz' })
      const wheel = art({ release: 'foo-1.0.0-manylinux_x86_64.whl' })
      // No darwin artifact present — falls through to sdist preference.
      const [picked] = deduplicateArtifacts([wheel, sdist], 'darwin-arm64')
      expect(picked).toBe(sdist)
    })
  })

  describe('priority cascade (no platform hint)', () => {
    it('prefers source distribution over wheels', () => {
      const wheel = art({ release: 'foo-1.0.0-cp310-manylinux_x86_64.whl' })
      const sdist = art({ release: 'foo-1.0.0.tar.gz' })
      const [picked] = deduplicateArtifacts([wheel, sdist])
      expect(picked).toBe(sdist)
    })

    it('recognizes .tar.bz2 as source distribution', () => {
      const wheel = art({ release: 'foo-1.0.0-cp310-manylinux_x86_64.whl' })
      const sdist = art({ release: 'foo-1.0.0.tar.bz2' })
      const [picked] = deduplicateArtifacts([wheel, sdist])
      expect(picked).toBe(sdist)
    })

    it('recognizes .zip as source distribution', () => {
      const wheel = art({ release: 'foo-1.0.0-cp310-manylinux_x86_64.whl' })
      const sdist = art({ release: 'foo-1.0.0.zip' })
      const [picked] = deduplicateArtifacts([wheel, sdist])
      expect(picked).toBe(sdist)
    })

    it('recognizes "sdist" in the release name', () => {
      const wheel = art({ release: 'foo-1.0.0-cp310-manylinux_x86_64.whl' })
      const sdist = art({ release: 'foo-1.0.0-sdist-extra' })
      const [picked] = deduplicateArtifacts([wheel, sdist])
      expect(picked).toBe(sdist)
    })

    it('prefers universal wheel over platform wheels when no sdist', () => {
      const linuxWheel = art({
        release: 'foo-1.0.0-cp310-manylinux_x86_64.whl',
      })
      const universal = art({ release: 'foo-1.0.0-py3-none-any.whl' })
      const [picked] = deduplicateArtifacts([linuxWheel, universal])
      expect(picked).toBe(universal)
    })

    it('recognizes none-any form as universal wheel', () => {
      const linuxWheel = art({
        release: 'foo-1.0.0-cp310-manylinux_x86_64.whl',
      })
      const universal = art({ release: 'foo-1.0.0-none-any.whl' })
      const [picked] = deduplicateArtifacts([linuxWheel, universal])
      expect(picked).toBe(universal)
    })

    it('falls back to first artifact when no sdist/universal/platform', () => {
      const a = art({ release: 'foo-1.0.0-cp310-manylinux_x86_64.whl' })
      const b = art({ release: 'foo-1.0.0-cp311-manylinux_x86_64.whl' })
      const [picked] = deduplicateArtifacts([a, b])
      expect(picked).toBe(a)
    })

    it('returns first artifact when releases are missing', () => {
      const a = art({ release: undefined })
      const b = art({ release: undefined })
      const [picked] = deduplicateArtifacts([a, b])
      expect(picked).toBe(a)
    })
  })

  describe('cross-package mixed groups', () => {
    it('dedups across multiple packages independently', () => {
      const fooWheel = art({
        name: 'foo',
        release: 'foo-1.0.0-manylinux_x86_64.whl',
      })
      const fooSdist = art({ name: 'foo', release: 'foo-1.0.0.tar.gz' })
      const barWheel = art({
        name: 'bar',
        release: 'bar-1.0.0-macosx_arm64.whl',
      })
      const result = deduplicateArtifacts(
        [fooWheel, fooSdist, barWheel],
        'darwin-arm64',
      )
      // foo: no darwin match → sdist wins.
      // bar: darwin-arm64 matches.
      expect(result).toHaveLength(2)
      expect(result.find(r => r.name === 'foo')).toBe(fooSdist)
      expect(result.find(r => r.name === 'bar')).toBe(barWheel)
    })
  })
})
