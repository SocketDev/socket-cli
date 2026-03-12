/**
 * Unit tests for constants barrel file.
 *
 * Purpose:
 * Tests the constants barrel export file to ensure all exports work correctly.
 *
 * Test Coverage:
 * - Named exports
 * - Default export
 *
 * Related Files:
 * - src/constants.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import constants, {
  FLAG_DRY_RUN,
  FLAG_JSON,
  FLAG_ORG,
  getCliVersion,
  LOOP_SENTINEL,
  NPM,
  OUTPUT_JSON,
  OUTPUT_MARKDOWN,
  OUTPUT_TEXT,
  PNPM,
  SOCKET_CLI_BIN_NAME,
  SOCKET_CLI_PACKAGE_NAME,
  VITEST,
  YARN,
} from '../../src/constants.mts'

describe('constants barrel exports', () => {
  describe('named exports', () => {
    it('exports flag constants', () => {
      // Flags include the -- prefix.
      expect(FLAG_DRY_RUN).toBe('--dry-run')
      expect(FLAG_JSON).toBe('--json')
      expect(FLAG_ORG).toBe('--org')
    })

    it('exports output format constants', () => {
      expect(OUTPUT_JSON).toBe('json')
      expect(OUTPUT_MARKDOWN).toBe('markdown')
      expect(OUTPUT_TEXT).toBe('text')
    })

    it('exports agent constants', () => {
      expect(NPM).toBe('npm')
      expect(PNPM).toBe('pnpm')
      expect(YARN).toBe('yarn')
    })

    it('exports error constants', () => {
      expect(typeof LOOP_SENTINEL).toBe('number')
    })

    it('exports package name constants', () => {
      expect(SOCKET_CLI_BIN_NAME).toBe('socket')
      // SOCKET_CLI_PACKAGE_NAME is the npm package name 'socket'.
      expect(SOCKET_CLI_PACKAGE_NAME).toBe('socket')
    })

    it('exports VITEST constant', () => {
      expect(VITEST).toBe(true)
    })

    it('exports getCliVersion function', () => {
      expect(typeof getCliVersion).toBe('function')
    })
  })

  describe('default export', () => {
    it('exports an object with constants', () => {
      expect(typeof constants).toBe('object')
    })

    it('includes flag constants', () => {
      expect(constants.FLAG_DRY_RUN).toBe('--dry-run')
      expect(constants.FLAG_JSON).toBe('--json')
    })

    it('includes output format constants', () => {
      expect(constants.OUTPUT_JSON).toBe('json')
      expect(constants.OUTPUT_MARKDOWN).toBe('markdown')
    })

    it('includes agent constants', () => {
      expect(constants.NPM).toBe('npm')
      expect(constants.PNPM).toBe('pnpm')
    })

    it('includes ENV object', () => {
      expect(typeof constants.ENV).toBe('object')
    })

    it('includes getCliVersion function', () => {
      expect(typeof constants.getCliVersion).toBe('function')
    })
  })
})
