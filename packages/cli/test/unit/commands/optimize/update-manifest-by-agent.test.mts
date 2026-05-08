/**
 * Unit tests for update-manifest-by-agent.
 *
 * Purpose:
 * Tests the functions that update package.json overrides for different package managers.
 *
 * Test Coverage:
 * - updateOverridesField
 * - updateResolutionsField
 * - updatePnpmField
 * - updateManifest
 *
 * Related Files:
 * - commands/optimize/update-manifest-by-agent.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  updateManifest,
  updateOverridesField,
  updatePkgJsonField,
  updatePnpmField,
  updateResolutionsField,
  usesPnpmWorkspaceOverrides,
} from '../../../../src/commands/optimize/update-manifest-by-agent.mts'

import type { EditablePackageJson } from '@socketsecurity/lib/packages'

describe('update-manifest-by-agent', () => {
  const createEditablePkgJson = (content: Record<string, any> = {}) => {
    const pkgJson: EditablePackageJson = {
      content,
      fromJSON: vi.fn((json: string) => {
        const parsed = JSON.parse(json)
        Object.assign(pkgJson.content, parsed)
      }),
      indent: '  ',
      newline: '\n',
      save: vi.fn(),
      update: vi.fn((updates: Record<string, any>) => {
        Object.assign(pkgJson.content, updates)
      }),
    } as unknown as EditablePackageJson
    return pkgJson
  }

  describe('updateOverridesField', () => {
    it('updates existing overrides field', () => {
      const pkgJson = createEditablePkgJson({
        name: 'test',
        overrides: { lodash: '4.17.20' },
      })
      updateOverridesField(pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.update).toHaveBeenCalledWith({ overrides: { lodash: '4.17.21' } })
    })

    it('removes overrides field when empty', () => {
      const pkgJson = createEditablePkgJson({
        name: 'test',
        overrides: { lodash: '4.17.20' },
      })
      updateOverridesField(pkgJson, {})
      expect(pkgJson.update).toHaveBeenCalledWith({ overrides: undefined })
    })

    it('does not add field for empty overrides when field does not exist', () => {
      const pkgJson = createEditablePkgJson({ name: 'test' })
      updateOverridesField(pkgJson, {})
      expect(pkgJson.update).not.toHaveBeenCalled()
      expect(pkgJson.fromJSON).not.toHaveBeenCalled()
    })

    it('adds new overrides field when it does not exist', () => {
      const pkgJson = createEditablePkgJson({ name: 'test' })
      updateOverridesField(pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })
  })

  describe('updateResolutionsField', () => {
    it('updates existing resolutions field', () => {
      const pkgJson = createEditablePkgJson({
        name: 'test',
        resolutions: { typescript: '5.0.0' },
      })
      updateResolutionsField(pkgJson, { typescript: '5.1.0' })
      expect(pkgJson.update).toHaveBeenCalledWith({
        resolutions: { typescript: '5.1.0' },
      })
    })

    it('removes resolutions field when empty', () => {
      const pkgJson = createEditablePkgJson({
        name: 'test',
        resolutions: { typescript: '5.0.0' },
      })
      updateResolutionsField(pkgJson, {})
      expect(pkgJson.update).toHaveBeenCalledWith({ resolutions: undefined })
    })
  })

  describe('updatePnpmField', () => {
    it('updates existing pnpm.overrides field', () => {
      const pkgJson = createEditablePkgJson({
        name: 'test',
        pnpm: { overrides: { express: '4.17.0' } },
      })
      updatePnpmField(pkgJson, { express: '4.18.0' })
      expect(pkgJson.update).toHaveBeenCalled()
      const updateArg = (pkgJson.update as any).mock.calls[0][0]
      expect(updateArg.pnpm.overrides).toEqual({ express: '4.18.0' })
    })

    it('removes pnpm.overrides when empty and pnpm has no keys', () => {
      const pkgJson = createEditablePkgJson({
        name: 'test',
        pnpm: { overrides: { express: '4.17.0' } },
      })
      updatePnpmField(pkgJson, {})
      // When pnpm only has overrides and we're removing it, the whole pnpm field is removed.
      expect(pkgJson.update).toHaveBeenCalled()
    })

    it('removes only overrides when pnpm has other fields', () => {
      const pkgJson = createEditablePkgJson({
        name: 'test',
        pnpm: {
          overrides: { express: '4.17.0' },
          patchedDependencies: { 'foo@1.0.0': 'patches/foo.patch' },
        },
      })
      updatePnpmField(pkgJson, {})
      expect(pkgJson.update).toHaveBeenCalled()
    })

    it('handles non-object pnpm value', () => {
      const pkgJson = createEditablePkgJson({
        name: 'test',
        pnpm: 'invalid',
      })
      updatePnpmField(pkgJson, { express: '4.18.0' })
      expect(pkgJson.update).toHaveBeenCalled()
    })
  })

  describe('updateManifest', () => {
    let pkgJson: EditablePackageJson

    beforeEach(() => {
      pkgJson = createEditablePkgJson({
        name: 'test',
      })
    })

    // Build a minimal EnvDetails-shaped object. Production code only
    // touches `editablePkgJson`, `agent`, `agentVersion`, `pkgPath`.
    const makeEnv = (
      overrides: Record<string, unknown> = {},
    ) => ({
      agent: 'pnpm',
      agentVersion: { major: 10, minor: 0, patch: 0 },
      editablePkgJson: pkgJson,
      pkgPath: '/tmp/test-pkg',
      ...overrides,
    }) as any

    it('uses resolutions for bun agent', async () => {
      await updateManifest('bun', makeEnv({ agent: 'bun' }), { lodash: '4.17.21' })
      // Since field doesn't exist, fromJSON is called.
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses pnpm field for pnpm 10 agent (legacy package.json path)', async () => {
      await updateManifest(
        'pnpm',
        makeEnv({ agent: 'pnpm', agentVersion: { major: 10, minor: 0, patch: 0 } }),
        { lodash: '4.17.21' },
      )
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses overrides for vlt agent', async () => {
      await updateManifest('vlt', makeEnv({ agent: 'vlt' }), { lodash: '4.17.21' })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses resolutions for yarn/berry agent', async () => {
      await updateManifest('yarn/berry', makeEnv({ agent: 'yarn/berry' }), {
        lodash: '4.17.21',
      })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses resolutions for yarn/classic agent', async () => {
      await updateManifest('yarn/classic', makeEnv({ agent: 'yarn/classic' }), {
        lodash: '4.17.21',
      })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses overrides for npm agent (default)', async () => {
      await updateManifest('npm', makeEnv({ agent: 'npm' }), {
        lodash: '4.17.21',
      })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses overrides for unknown agent', async () => {
      await updateManifest('unknown' as any, makeEnv({ agent: 'unknown' }), {
        lodash: '4.17.21',
      })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('updates existing resolutions for yarn', async () => {
      pkgJson = createEditablePkgJson({
        name: 'test',
        resolutions: { typescript: '5.0.0' },
      })
      await updateManifest(
        'yarn/berry',
        makeEnv({ agent: 'yarn/berry', editablePkgJson: pkgJson }),
        { lodash: '4.17.21' },
      )
      expect(pkgJson.update).toHaveBeenCalledWith({
        resolutions: { lodash: '4.17.21' },
      })
    })

    it('updates existing overrides for npm', async () => {
      pkgJson = createEditablePkgJson({
        name: 'test',
        overrides: { express: '4.17.0' },
      })
      await updateManifest(
        'npm',
        makeEnv({ agent: 'npm', editablePkgJson: pkgJson }),
        { lodash: '4.17.21' },
      )
      expect(pkgJson.update).toHaveBeenCalledWith({
        overrides: { lodash: '4.17.21' },
      })
    })

    it('places new overrides AFTER main when no engines/files anchor exists', async () => {
      // No engines/files -> falls through to getHighestEntryIndex(['exports','imports','main']),
      // which returns the position of `main`; we then place at that index + 1
      // because isPlacingHigher = true. Verifies the L130 +1 path.
      pkgJson = createEditablePkgJson({
        name: 'test',
        version: '1.0.0',
        main: 'index.js',
        scripts: {},
      })
      await updateManifest(
        'npm',
        makeEnv({ agent: 'npm', editablePkgJson: pkgJson }),
        { lodash: '4.17.21' },
      )

      expect(pkgJson.fromJSON).toHaveBeenCalled()
      // The new content should include overrides positioned after main.
      const fromJsonCall = (pkgJson.fromJSON as any).mock.calls[0][0] as string
      const parsed = JSON.parse(fromJsonCall)
      const keys = Object.keys(parsed)
      expect(keys.indexOf('overrides')).toBeGreaterThan(keys.indexOf('main'))
      expect(parsed.overrides).toEqual({ lodash: '4.17.21' })
    })
  })

  describe('usesPnpmWorkspaceOverrides', () => {
    it('returns true for pnpm 11+', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'pnpm',
          agentVersion: { major: 11, minor: 0, patch: 8 } as any,
        }),
      ).toBe(true)
    })

    it('returns true for pnpm 12+', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'pnpm',
          agentVersion: { major: 12, minor: 0, patch: 0 } as any,
        }),
      ).toBe(true)
    })

    it('returns false for pnpm 10', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'pnpm',
          agentVersion: { major: 10, minor: 12, patch: 0 } as any,
        }),
      ).toBe(false)
    })

    it('returns false for pnpm 9', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'pnpm',
          agentVersion: { major: 9, minor: 0, patch: 0 } as any,
        }),
      ).toBe(false)
    })

    it('returns false for non-pnpm agents (regardless of version)', () => {
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'npm',
          agentVersion: { major: 11, minor: 0, patch: 0 } as any,
        }),
      ).toBe(false)
      expect(
        usesPnpmWorkspaceOverrides({
          agent: 'yarn/berry',
          agentVersion: { major: 11, minor: 0, patch: 0 } as any,
        }),
      ).toBe(false)
    })
  })

  describe('getEntryIndexes / getLowestEntryIndex / getHighestEntryIndex', () => {
    const entries: Array<[string, any]> = [
      ['name', 'x'],
      ['version', '1.0.0'],
      ['main', 'index.js'],
      ['exports', {}],
      ['scripts', {}],
    ]

    it('getEntryIndexes returns sorted indices for matching keys', async () => {
      const { getEntryIndexes } = await import(
        '../../../../src/commands/optimize/update-manifest-by-agent.mts'
      )
      expect(getEntryIndexes(entries, ['exports', 'main'])).toEqual([2, 3])
    })

    it('getEntryIndexes filters out keys not present', async () => {
      const { getEntryIndexes } = await import(
        '../../../../src/commands/optimize/update-manifest-by-agent.mts'
      )
      expect(getEntryIndexes(entries, ['nope', 'main'])).toEqual([2])
    })

    it('getLowestEntryIndex returns -1 when no keys match', async () => {
      const { getLowestEntryIndex } = await import(
        '../../../../src/commands/optimize/update-manifest-by-agent.mts'
      )
      expect(getLowestEntryIndex(entries, ['nope'])).toBe(-1)
    })

    it('getLowestEntryIndex returns the smallest matching index', async () => {
      const { getLowestEntryIndex } = await import(
        '../../../../src/commands/optimize/update-manifest-by-agent.mts'
      )
      expect(getLowestEntryIndex(entries, ['scripts', 'main'])).toBe(2)
    })

    it('getHighestEntryIndex returns -1 when no keys match', async () => {
      const { getHighestEntryIndex } = await import(
        '../../../../src/commands/optimize/update-manifest-by-agent.mts'
      )
      expect(getHighestEntryIndex(entries, ['nope'])).toBe(-1)
    })

    it('getHighestEntryIndex returns the largest matching index', async () => {
      const { getHighestEntryIndex } = await import(
        '../../../../src/commands/optimize/update-manifest-by-agent.mts'
      )
      expect(getHighestEntryIndex(entries, ['main', 'scripts'])).toBe(4)
    })
  })

  describe('updatePkgJsonField with non-overrides field', () => {
    it('updates non-OVERRIDES/RESOLUTIONS/PNPM field by simple assignment', () => {
      const pkgJson = createEditablePkgJson({ name: 'test', custom: 'old' })
      updatePkgJsonField(pkgJson, 'custom', 'new-value')
      expect(pkgJson.update).toHaveBeenCalledWith({ custom: 'new-value' })
    })
  })
})
