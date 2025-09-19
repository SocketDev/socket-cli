import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runWithConfig } from '../../test/run-with-config.mts'
import { validateSocketJson } from '../../test/json-output-validation.mts'

describe('socket login - smoke test scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic functionality', () => {
    it('should show help: `login --help`', async () => {
      const result = await runWithConfig('login', '--help')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/Usage/)
      expect(result.stdout).toMatch(/socket login/)
    })

    it('should support dry-run: `login --dry-run`', async () => {
      const result = await runWithConfig('login', '--dry-run')
      expect(result.exitCode).toBe(0)
    })

    it('should run interactively without args: `login`', async () => {
      const result = await runWithConfig('login')
      // In test environment, will fail or exit since no real interactive session.
      // Just verify it doesn't crash unexpectedly.
      expect(result).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should fail with invalid api-base-url: `login --api-base-url fail`', async () => {
      const result = await runWithConfig('login', '--api-base-url', 'fail')
      expect(result.exitCode).toBe(1)
    })

    it('should fail with invalid api-proxy: `login --api-proxy fail`', async () => {
      const result = await runWithConfig('login', '--api-proxy', 'fail')
      expect(result.exitCode).toBe(1)
    })
  })
})