/**
 * Unit tests for get-overrides-by-agent.
 *
 * Purpose:
 * Tests the functions that get overrides from package.json for different package managers.
 *
 * Test Coverage:
 * - getOverridesData for all package managers
 * - getOverridesDataNpm
 * - getOverridesDataPnpm
 * - getOverridesDataYarn/YarnClassic
 * - getOverridesDataBun
 * - getOverridesDataVlt
 *
 * Related Files:
 * - commands/optimize/get-overrides-by-agent.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  getOverridesData,
  getOverridesDataBun,
  getOverridesDataNpm,
  getOverridesDataPnpm,
  getOverridesDataVlt,
  getOverridesDataYarn,
  getOverridesDataYarnClassic,
} from '../../../../src/commands/optimize/get-overrides-by-agent.mts'

import type { EnvDetails } from '../../../../src/utils/ecosystem/environment.mjs'

describe('get-overrides-by-agent', () => {
  const createEnvDetails = (agent: string, pkgJsonContent: any = {}): EnvDetails =>
    ({
      agent,
      editablePkgJson: {
        content: pkgJsonContent,
      },
    }) as unknown as EnvDetails

  describe('getOverridesDataNpm', () => {
    it('returns npm overrides from package.json', () => {
      const envDetails = createEnvDetails('npm', {
        overrides: {
          lodash: '4.17.21',
        },
      })
      const result = getOverridesDataNpm(envDetails)
      expect(result.type).toBe('npm')
      expect(result.overrides).toEqual({ lodash: '4.17.21' })
    })

    it('returns empty overrides when none exist', () => {
      const envDetails = createEnvDetails('npm', {})
      const result = getOverridesDataNpm(envDetails)
      expect(result.type).toBe('npm')
      expect(result.overrides).toEqual({})
    })

    it('accepts custom pkgJson', () => {
      const envDetails = createEnvDetails('npm', { overrides: { a: '1' } })
      const result = getOverridesDataNpm(envDetails, { overrides: { b: '2' } })
      expect(result.overrides).toEqual({ b: '2' })
    })
  })

  describe('getOverridesDataPnpm', () => {
    it('returns pnpm overrides from package.json', () => {
      const envDetails = createEnvDetails('pnpm', {
        pnpm: {
          overrides: {
            express: '4.18.0',
          },
        },
      })
      const result = getOverridesDataPnpm(envDetails)
      expect(result.type).toBe('pnpm')
      expect(result.overrides).toEqual({ express: '4.18.0' })
    })

    it('returns empty overrides when pnpm section missing', () => {
      const envDetails = createEnvDetails('pnpm', {})
      const result = getOverridesDataPnpm(envDetails)
      expect(result.type).toBe('pnpm')
      expect(result.overrides).toEqual({})
    })

    it('returns empty overrides when overrides missing in pnpm section', () => {
      const envDetails = createEnvDetails('pnpm', { pnpm: {} })
      const result = getOverridesDataPnpm(envDetails)
      expect(result.overrides).toEqual({})
    })
  })

  describe('getOverridesDataYarn', () => {
    it('returns yarn resolutions from package.json', () => {
      const envDetails = createEnvDetails('yarn', {
        resolutions: {
          typescript: '5.0.0',
        },
      })
      const result = getOverridesDataYarn(envDetails)
      expect(result.type).toBe('yarn/berry')
      expect(result.overrides).toEqual({ typescript: '5.0.0' })
    })

    it('returns empty overrides when resolutions missing', () => {
      const envDetails = createEnvDetails('yarn', {})
      const result = getOverridesDataYarn(envDetails)
      expect(result.overrides).toEqual({})
    })
  })

  describe('getOverridesDataYarnClassic', () => {
    it('returns yarn classic resolutions from package.json', () => {
      const envDetails = createEnvDetails('yarn/classic', {
        resolutions: {
          react: '18.0.0',
        },
      })
      const result = getOverridesDataYarnClassic(envDetails)
      expect(result.type).toBe('yarn/classic')
      expect(result.overrides).toEqual({ react: '18.0.0' })
    })
  })

  describe('getOverridesDataBun', () => {
    it('returns bun resolutions from package.json', () => {
      const envDetails = createEnvDetails('bun', {
        resolutions: {
          'jest': '29.0.0',
        },
      })
      const result = getOverridesDataBun(envDetails)
      expect(result.type).toBe('yarn/berry')
      expect(result.overrides).toEqual({ jest: '29.0.0' })
    })
  })

  describe('getOverridesDataVlt', () => {
    it('returns vlt overrides from package.json', () => {
      const envDetails = createEnvDetails('vlt', {
        overrides: {
          chalk: '5.0.0',
        },
      })
      const result = getOverridesDataVlt(envDetails)
      expect(result.type).toBe('vlt')
      expect(result.overrides).toEqual({ chalk: '5.0.0' })
    })
  })

  describe('getOverridesData', () => {
    it('returns npm overrides for npm agent', () => {
      const envDetails = createEnvDetails('npm', { overrides: { a: '1' } })
      const result = getOverridesData(envDetails)
      expect(result.type).toBe('npm')
      expect(result.overrides).toEqual({ a: '1' })
    })

    it('returns pnpm overrides for pnpm agent', () => {
      const envDetails = createEnvDetails('pnpm', { pnpm: { overrides: { b: '2' } } })
      const result = getOverridesData(envDetails)
      expect(result.type).toBe('pnpm')
      expect(result.overrides).toEqual({ b: '2' })
    })

    it('returns yarn overrides for yarn-berry agent', () => {
      const envDetails = createEnvDetails('yarn/berry', { resolutions: { c: '3' } })
      const result = getOverridesData(envDetails)
      expect(result.type).toBe('yarn/berry')
      expect(result.overrides).toEqual({ c: '3' })
    })

    it('returns yarn classic overrides for yarn-classic agent', () => {
      const envDetails = createEnvDetails('yarn/classic', { resolutions: { d: '4' } })
      const result = getOverridesData(envDetails)
      expect(result.type).toBe('yarn/classic')
      expect(result.overrides).toEqual({ d: '4' })
    })

    it('returns bun overrides for bun agent', () => {
      const envDetails = createEnvDetails('bun', { resolutions: { e: '5' } })
      const result = getOverridesData(envDetails)
      expect(result.type).toBe('yarn/berry')
      expect(result.overrides).toEqual({ e: '5' })
    })

    it('returns vlt overrides for vlt agent', () => {
      const envDetails = createEnvDetails('vlt', { overrides: { f: '6' } })
      const result = getOverridesData(envDetails)
      expect(result.type).toBe('vlt')
      expect(result.overrides).toEqual({ f: '6' })
    })

    it('defaults to npm for unknown agent', () => {
      const envDetails = createEnvDetails('unknown', { overrides: { g: '7' } })
      const result = getOverridesData(envDetails)
      expect(result.type).toBe('npm')
      expect(result.overrides).toEqual({ g: '7' })
    })
  })
})
