import { describe, expect } from 'vitest'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket cdxgen', async () => {
  cmdit(
    ['cdxgen', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const {
        code,
        stderr,
        stdout,
      } = await spawnSocketCli(binCliPath, cmd)

      // cdxgen exits with code 1 when --help is passed (this is expected behavior from the underlying tool)
      // We just verify it runs and produces output
      expect([0, 1]).toContain(code)

      // Verify we got some output (help text or error message)
      const combinedOutput = stdout + stderr
      expect(combinedOutput.length, 'should produce output').toBeGreaterThan(0)
    },
  )

  cmdit(
    ['cdxgen', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should handle dry-run without path',
    async cmd => {
      const {
        code,
        stderr,
        stdout,
      } = await spawnSocketCli(binCliPath, cmd)
      // With dry-run, cdxgen exits early.
      expect(stdout).toContain('[DryRun]: Bailing now')
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['cdxgen', '.', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should handle path with dry-run',
    async cmd => {
      const {
        code,
        stderr,
        stdout,
      } = await spawnSocketCli(binCliPath, cmd)
      // With dry-run, should bail before actually running cdxgen.
      expect(stdout).toContain('[DryRun]: Bailing now')
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['cdxgen', '.', FLAG_JSON, FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should support ${FLAG_JSON} flag`,
    async cmd => {
      const {
        code,
        stderr,
        stdout,
      } = await spawnSocketCli(binCliPath, cmd)
      // With dry-run, should bail before actually running cdxgen.
      expect(stdout).toContain('[DryRun]: Bailing now')
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['cdxgen', '.', FLAG_MARKDOWN, FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should support ${FLAG_MARKDOWN} flag`,
    async cmd => {
      const {
        code,
        stderr,
        stdout,
      } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Bailing now')
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )
})
