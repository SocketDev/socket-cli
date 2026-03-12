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
  updatePnpmField,
  updateResolutionsField,
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

    it('uses resolutions for bun agent', () => {
      updateManifest('bun', pkgJson, { lodash: '4.17.21' })
      // Since field doesn't exist, fromJSON is called.
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses pnpm field for pnpm agent', () => {
      updateManifest('pnpm', pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses overrides for vlt agent', () => {
      updateManifest('vlt', pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses resolutions for yarn/berry agent', () => {
      updateManifest('yarn/berry', pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses resolutions for yarn/classic agent', () => {
      updateManifest('yarn/classic', pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses overrides for npm agent (default)', () => {
      updateManifest('npm', pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('uses overrides for unknown agent', () => {
      updateManifest('unknown' as any, pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.fromJSON).toHaveBeenCalled()
    })

    it('updates existing resolutions for yarn', () => {
      pkgJson = createEditablePkgJson({
        name: 'test',
        resolutions: { typescript: '5.0.0' },
      })
      updateManifest('yarn/berry', pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.update).toHaveBeenCalledWith({
        resolutions: { lodash: '4.17.21' },
      })
    })

    it('updates existing overrides for npm', () => {
      pkgJson = createEditablePkgJson({
        name: 'test',
        overrides: { express: '4.17.0' },
      })
      updateManifest('npm', pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.update).toHaveBeenCalledWith({
        overrides: { lodash: '4.17.21' },
      })
    })
  })
})
