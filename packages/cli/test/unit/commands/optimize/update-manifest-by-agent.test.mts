/**
 * Unit tests for update-manifest-by-agent's package.json field helpers.
 *
 * Purpose: Tests the functions that update package.json overrides for different
 * package managers.
 *
 * Test Coverage: - updateOverridesField - updateResolutionsField -
 * updatePnpmField - updatePkgJsonField.
 *
 * Related Files: - commands/optimize/update-manifest-by-agent.mts
 * (implementation)
 */

import { describe, expect, it, vi } from 'vitest'

import {
  updateOverridesField,
  updatePkgJsonField,
  updatePnpmField,
  updateResolutionsField,
} from '../../../../src/commands/optimize/update-manifest-by-agent.mts'

import type { EditablePackageJson } from '@socketsecurity/lib-stable/packages/types'

// The factory below substitutes vi.fn() mocks for the class methods; typing
// them as Mock keeps expect(pkgJson.update) clear of unbound-method.
type MockEditablePackageJson = EditablePackageJson & {
  fromJSON: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

describe('update-manifest-by-agent', () => {
  const createEditablePkgJson = (content: Record<string, unknown> = {}) => {
    const pkgJson: MockEditablePackageJson = {
      content,
      fromJSON: vi.fn((json: string) => {
        const parsed = JSON.parse(json)
        Object.assign(pkgJson.content, parsed)
      }),
      indent: '  ',
      newline: '\n',
      save: vi.fn(),
      update: vi.fn((updates: Record<string, unknown>) => {
        Object.assign(pkgJson.content, updates)
      }),
    } as unknown as MockEditablePackageJson
    return pkgJson
  }

  describe('updateOverridesField', () => {
    it('updates existing overrides field', () => {
      const pkgJson = createEditablePkgJson({
        name: 'test',
        overrides: { lodash: '4.17.20' },
      })
      updateOverridesField(pkgJson, { lodash: '4.17.21' })
      expect(pkgJson.update).toHaveBeenCalledWith({
        overrides: { lodash: '4.17.21' },
      })
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
      const updateArg = (pkgJson.update as unknown).mock.calls[0][0]
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

    it('clears non-object pnpm value when overrides empty (line 135-138)', () => {
      // pnpm exists but isn't an object (e.g. a string value) AND the
      // incoming overrides are empty — the only safe move is to drop
      // the whole `pnpm` field by setting it to undefined.
      const pkgJson = createEditablePkgJson({
        name: 'test',
        pnpm: 'invalid',
      })
      updatePnpmField(pkgJson, {})
      expect(pkgJson.update).toHaveBeenCalledWith({ pnpm: undefined })
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
