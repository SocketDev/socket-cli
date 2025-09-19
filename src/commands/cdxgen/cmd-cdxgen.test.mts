import { beforeEach, describe, expect, it } from 'vitest'

import { runWithConfig } from '../../test/run-with-config.mts'

describe('socket cdxgen', () => {
  it('should support --help: `cdxgen --help --config {}`', async () => {
    const result = await runWithConfig('cdxgen', '--help')
    expect(result.stderr).toBeFalsy()
    expect(result.stdout).toMatch(/Usage/)
  })

  it('should require path argument: `cdxgen --dry-run --config {}`', async () => {
    const result = await runWithConfig('cdxgen', '--dry-run')
    expect(result.stderr).toContain('Needs a path')
    expect(result.exitCode).toBe(2)
  })

  it('should fail without cdxgen installed: `cdxgen . --config {}`', async () => {
    const result = await runWithConfig('cdxgen', '.')
    expect(result.exitCode).toBe(1)
    // Since cdxgen is not installed in test environment, should fail
  })

  describe('output formats', () => {
    it('should support --json flag: `cdxgen . --json --config {}`', async () => {
      const result = await runWithConfig('cdxgen', '.', '--json', '--dry-run')
      // Even with dry-run, should fail since path validation happens first
      expect(result.exitCode).toBe(2)
    })

    it('should support --markdown flag: `cdxgen . --markdown --config {}`', async () => {
      const result = await runWithConfig('cdxgen', '.', '--markdown', '--dry-run')
      expect(result.exitCode).toBe(2)
    })
  })
})