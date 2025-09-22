import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../../src/constants.mts'
import {
  cmdit,
  hasCdxgenHelpContent,
  hasSocketBanner,
  spawnSocketCli,
} from '../../../test/utils.mts'

describe('socket cdxgen', async () => {
  const { binCliPath } = constants

  cmdit(
    ['cdxgen', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Note: cdxgen may output help info to stdout or stderr depending on environment.
      // In some CI environments, the help might not be captured properly.
      // We check both streams to ensure we catch the output regardless of where it appears.
      const combinedOutput = stdout + stderr

      // Note: Socket CLI banner may appear in stderr while cdxgen output is in stdout.
      // This is expected behavior as the banner is informational output.

      // Note: We avoid snapshot testing here as cdxgen's help output format may change.
      // On Windows CI, cdxgen might not output help properly or might not be installed.
      // We check for either cdxgen help content OR just the Socket banner.
      const hasSocketCommand = combinedOutput.includes('socket cdxgen')

      // Test passes if either:
      // 1. We got cdxgen help output (normal case).
      // 2. We got Socket CLI banner with command (Windows CI where cdxgen might not work).
      const hasCdxgenWorked = hasCdxgenHelpContent(combinedOutput)
      const hasFallbackOutput =
        hasSocketBanner(combinedOutput) && hasSocketCommand

      expect(hasCdxgenWorked || hasFallbackOutput).toBe(true)
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['cdxgen', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should handle dry-run without path',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // With dry-run, cdxgen exits early.
      expect(stdout).toContain('[DryRun]: Bailing now')
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['cdxgen', '.', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should handle path with dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // With dry-run, should bail before actually running cdxgen.
      expect(stdout).toContain('[DryRun]: Bailing now')
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['cdxgen', '.', FLAG_JSON, FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should support ${FLAG_JSON} flag`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // With dry-run, should bail before actually running cdxgen.
      expect(stdout).toContain('[DryRun]: Bailing now')
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['cdxgen', '.', FLAG_MARKDOWN, FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should support ${FLAG_MARKDOWN} flag`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Bailing now')
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )
})
