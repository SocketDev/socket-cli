import { describe, expect, it } from 'vitest'

import { validateSocketJson } from '../../../test/json-output-validation.mts'
import { runWithConfig } from '../../../test/run-with-config.mts'

describe('socket repos - smoke test scenarios', () => {
  describe('no-interactive mode', () => {
    it('should fail create without org in no-interactive mode: `repos create "cli_donotcreate" --json --no-interactive`', async () => {
      const result = await runWithConfig(
        'repos',
        'create',
        'cli_donotcreate',
        '--json',
        '--no-interactive',
        '--config',
        '{}',
      )
      expect(result.exitCode).toBe(2)

      // Validate JSON error format.
      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
      if (!jsonResponse.ok) {
        expect(jsonResponse.message).toBeTruthy()
      }
    })

    it('should fail del without org in no-interactive mode: `repos del "cli_donotcreate" --json --no-interactive`', async () => {
      const result = await runWithConfig(
        'repos',
        'del',
        'cli_donotcreate',
        '--json',
        '--no-interactive',
        '--config',
        '{}',
      )
      expect(result.exitCode).toBe(2)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })

    it('should fail view without org in no-interactive mode: `repos view "cli_donotcreate" --json --no-interactive`', async () => {
      const result = await runWithConfig(
        'repos',
        'view',
        'cli_donotcreate',
        '--json',
        '--no-interactive',
        '--config',
        '{}',
      )
      expect(result.exitCode).toBe(2)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })

    it('should fail list without org in no-interactive mode: `repos list --json --no-interactive`', async () => {
      const result = await runWithConfig(
        'repos',
        'list',
        '--json',
        '--no-interactive',
        '--config',
        '{}',
      )
      expect(result.exitCode).toBe(2)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })

    it('should fail update without org in no-interactive mode: `repos update "cli_donotcreate" --homepage evil --json --no-interactive`', async () => {
      const result = await runWithConfig(
        'repos',
        'update',
        'cli_donotcreate',
        '--homepage',
        'evil',
        '--json',
        '--no-interactive',
        '--config',
        '{}',
      )
      expect(result.exitCode).toBe(2)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })
  })

  describe('with fake org', () => {
    const fakeOrgConfig = '{"defaultOrg": "fake_org", "apiToken": "fake_token"}'

    it('should fail create with fake org: `repos create "cli_donotcreate" --json`', async () => {
      const result = await runWithConfig(
        'repos',
        'create',
        'cli_donotcreate',
        '--json',
        '--config',
        fakeOrgConfig,
      )
      expect(result.exitCode).toBe(1)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })

    it('should fail del with fake org: `repos del "cli_donotcreate" --json`', async () => {
      const result = await runWithConfig(
        'repos',
        'del',
        'cli_donotcreate',
        '--json',
        '--config',
        fakeOrgConfig,
      )
      expect(result.exitCode).toBe(1)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })

    it('should fail view with fake org: `repos view "cli_donotcreate" --json`', async () => {
      const result = await runWithConfig(
        'repos',
        'view',
        'cli_donotcreate',
        '--json',
        '--config',
        fakeOrgConfig,
      )
      expect(result.exitCode).toBe(1)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })

    it('should fail list with fake org: `repos list --json`', async () => {
      const result = await runWithConfig(
        'repos',
        'list',
        '--json',
        '--config',
        fakeOrgConfig,
      )
      expect(result.exitCode).toBe(1)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })

    it('should fail update with fake org: `repos update "cli_donotcreate" --homepage evil --json`', async () => {
      const result = await runWithConfig(
        'repos',
        'update',
        'cli_donotcreate',
        '--homepage',
        'evil',
        '--json',
        '--config',
        fakeOrgConfig,
      )
      expect(result.exitCode).toBe(1)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })
  })

  describe('invalid repository names', () => {
    it('should fail create with invalid name: `repos create "%$#"`', async () => {
      const result = await runWithConfig('repos', 'create', '%$#')
      expect(result.exitCode).toBe(2)
    })

    it('should fail create with invalid name and json: `repos create "%$#" --json`', async () => {
      const result = await runWithConfig('repos', 'create', '%$#', '--json')
      expect(result.exitCode).toBe(2)

      const jsonResponse = validateSocketJson(result.stdout, result.exitCode)
      expect(jsonResponse.ok).toBe(false)
    })
  })
})
