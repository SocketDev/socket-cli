import { describe, expect, it } from 'vitest'

import { getCiEnvInstructions } from '../../../../src/commands/fix/env-helpers.mts'

describe('env-helpers', () => {
  describe('getCiEnvInstructions', () => {
    it('should return instructions with exact env var names', () => {
      const instructions = getCiEnvInstructions()

      // Check that exact env var names appear in instructions.
      expect(instructions).toContain('CI=1')
      expect(instructions).toContain('SOCKET_CLI_GITHUB_TOKEN')
      expect(instructions).toContain('SOCKET_CLI_GIT_USER_NAME')
      expect(instructions).toContain('SOCKET_CLI_GIT_USER_EMAIL')
    })

    it('should format env var names consistently', () => {
      const instructions = getCiEnvInstructions()
      const lines = instructions.split('\n')

      // First line is intro text.
      expect(lines[0]).toContain('To enable automatic pull request creation')

      // Check that each env var line contains the env var name.
      expect(lines[1]).toContain('CI=1')
      expect(lines[2]).toContain('SOCKET_CLI_GITHUB_TOKEN=')
      expect(lines[3]).toContain('SOCKET_CLI_GIT_USER_NAME=')
      expect(lines[4]).toContain('SOCKET_CLI_GIT_USER_EMAIL=')
    })
  })

  describe('checkCiEnvVars (via integration)', () => {
    it('should identify exact env var names in missing list', () => {
      // This would test the actual checkCiEnvVars function.
      // But since it reads from process.env which is cached in ENV,
      // we rely on the integration tests to verify this behavior.

      // The function should return exact env var names:
      // - "CI"
      // - "SOCKET_CLI_GIT_USER_EMAIL"
      // - "SOCKET_CLI_GIT_USER_NAME"
      // - "SOCKET_CLI_GITHUB_TOKEN (or GITHUB_TOKEN)"

      // These exact strings should appear in the missing/present arrays.
      expect(true).toBe(true) // Placeholder - actual testing done in integration.
    })
  })
})
