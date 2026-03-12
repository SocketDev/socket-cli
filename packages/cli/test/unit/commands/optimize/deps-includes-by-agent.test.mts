/**
 * Unit tests for deps-includes-by-agent.
 *
 * Purpose:
 * Tests the functions that check if a package name exists in ls/query output.
 *
 * Test Coverage:
 * - matchLsCmdViewHumanStdout
 * - matchQueryCmdStdout
 * - lsStdoutIncludes
 *
 * Related Files:
 * - commands/optimize/deps-includes-by-agent.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  lsStdoutIncludes,
  matchLsCmdViewHumanStdout,
  matchQueryCmdStdout,
} from '../../../../src/commands/optimize/deps-includes-by-agent.mts'

import type { EnvDetails } from '../../../../src/utils/ecosystem/environment.mjs'

describe('deps-includes-by-agent', () => {
  describe('matchLsCmdViewHumanStdout', () => {
    it('returns true when package name with @ version exists', () => {
      const stdout = `├── lodash@4.17.21
├── express@4.18.0`
      expect(matchLsCmdViewHumanStdout(stdout, 'lodash')).toBe(true)
    })

    it('returns true for nested package with space prefix', () => {
      const stdout = `project@1.0.0
├── lodash@4.17.21
│   └── nested@1.0.0`
      expect(matchLsCmdViewHumanStdout(stdout, 'lodash')).toBe(true)
    })

    it('returns false when package does not exist', () => {
      const stdout = `├── express@4.18.0`
      expect(matchLsCmdViewHumanStdout(stdout, 'lodash')).toBe(false)
    })

    it('returns false for partial name match without space prefix', () => {
      const stdout = `├── lodash-es@4.17.21`
      // 'lodash-es' starts with 'lodash' but ' lodash@' pattern won't match.
      expect(matchLsCmdViewHumanStdout(stdout, 'lodash')).toBe(false)
    })

    it('handles scoped packages', () => {
      const stdout = `├── @babel/core@7.0.0`
      expect(matchLsCmdViewHumanStdout(stdout, '@babel/core')).toBe(true)
    })
  })

  describe('matchQueryCmdStdout', () => {
    it('returns true when package name in quotes exists', () => {
      const stdout = `{"name":"lodash","version":"4.17.21"}`
      expect(matchQueryCmdStdout(stdout, 'lodash')).toBe(true)
    })

    it('returns true for package name in JSON array', () => {
      const stdout = `[{"name":"lodash"},{"name":"express"}]`
      expect(matchQueryCmdStdout(stdout, 'lodash')).toBe(true)
    })

    it('returns false when package does not exist', () => {
      const stdout = `{"name":"express","version":"4.18.0"}`
      expect(matchQueryCmdStdout(stdout, 'lodash')).toBe(false)
    })

    it('handles scoped packages', () => {
      const stdout = `{"name":"@babel/core"}`
      expect(matchQueryCmdStdout(stdout, '@babel/core')).toBe(true)
    })

    it('does not match unquoted text', () => {
      const stdout = `lodash is a package`
      expect(matchQueryCmdStdout(stdout, 'lodash')).toBe(false)
    })

    it('does not match partial package names in JSON', () => {
      const stdout = `{"name":"lodash-es"}`
      expect(matchQueryCmdStdout(stdout, 'lodash')).toBe(false)
    })

    it('returns false for empty stdout', () => {
      expect(matchQueryCmdStdout('', 'lodash')).toBe(false)
    })

    it('returns false for empty package name', () => {
      const stdout = `{"name":"lodash"}`
      expect(matchQueryCmdStdout(stdout, '')).toBe(false)
    })
  })

  describe('lsStdoutIncludes', () => {
    const createEnvDetails = (agent: string): EnvDetails =>
      ({ agent }) as unknown as EnvDetails

    it('uses human format for bun agent', () => {
      const stdout = `├── lodash@4.17.21`
      expect(lsStdoutIncludes(createEnvDetails('bun'), stdout, 'lodash')).toBe(
        true,
      )
    })

    it('uses human format for yarn/berry agent', () => {
      const stdout = `├── lodash@4.17.21`
      expect(
        lsStdoutIncludes(createEnvDetails('yarn/berry'), stdout, 'lodash'),
      ).toBe(true)
    })

    it('uses human format for yarn/classic agent', () => {
      const stdout = `├── lodash@4.17.21`
      expect(
        lsStdoutIncludes(createEnvDetails('yarn/classic'), stdout, 'lodash'),
      ).toBe(true)
    })

    it('uses query format for npm agent', () => {
      const stdout = `{"name":"lodash"}`
      expect(lsStdoutIncludes(createEnvDetails('npm'), stdout, 'lodash')).toBe(
        true,
      )
    })

    it('uses query format for pnpm agent', () => {
      const stdout = `{"name":"lodash"}`
      expect(lsStdoutIncludes(createEnvDetails('pnpm'), stdout, 'lodash')).toBe(
        true,
      )
    })

    it('uses query format for unknown agent', () => {
      const stdout = `{"name":"lodash"}`
      expect(
        lsStdoutIncludes(createEnvDetails('unknown'), stdout, 'lodash'),
      ).toBe(true)
    })

    it('returns false when package not found in bun format', () => {
      const stdout = `├── express@4.18.0`
      expect(lsStdoutIncludes(createEnvDetails('bun'), stdout, 'lodash')).toBe(
        false,
      )
    })

    it('returns false when package not found in npm format', () => {
      const stdout = `{"name":"express"}`
      expect(lsStdoutIncludes(createEnvDetails('npm'), stdout, 'lodash')).toBe(
        false,
      )
    })
  })
})
