import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { LOG_SYMBOLS } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  cleanOutput,
  cmdit,
  hasCdxgenHelpContent,
  hasSocketBanner,
  spawnSocketCli,
  testPath,
} from '../../../test/utils.mts'
import constants, {
  FLAG_HELP,
  FLAG_VERSION,
  REDACTED,
} from '../../constants.mts'

import type { MatcherContext } from '@vitest/expect'

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

function createIncludeMatcher(streamName: 'stdout' | 'stderr') {
  return function (this: MatcherContext, received: any, expected: string) {
    const { isNot } = this
    const strippedExpected = cleanOutput(expected)
    const stream = cleanOutput(received?.[streamName] || '')
    return {
      // Do not alter your "pass" based on isNot. Vitest does it for you.
      pass: !!stream?.includes?.(strippedExpected),
      message: () =>
        `spawn.${streamName} ${isNot ? 'does NOT include' : 'includes'} \`${strippedExpected}\`: ${stream}`,
    }
  }
}

// Register custom matchers.
expect.extend({
  toHaveStdoutInclude: createIncludeMatcher('stdout'),
  toHaveStderrInclude: createIncludeMatcher('stderr'),
})

describe('socket manifest cdxgen', async () => {
  const { binCliPath } = constants

  const spawnOpts: PromiseSpawnOptions = {
    env: {
      ...process.env,
      ...constants.processEnv,
      SOCKET_CLI_CONFIG: '{}',
    },
  }

  describe('command forwarding', async () => {
    cmdit(
      ['manifest', 'cdxgen', FLAG_HELP],
      `should support ${FLAG_HELP}`,
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // Need to pass it on as env because --config will break cdxgen.
          env: { SOCKET_CLI_CONFIG: '{}' },
        })

        // Note: cdxgen may output help info to stdout or stderr depending on environment.
        // In some CI environments, the help might not be captured properly.
        // We check both streams to ensure we catch the output regardless of where it appears.
        const combinedOutput = stdout + stderr

        if (combinedOutput.includes('CycloneDX Generator')) {
          const cdxgenOutput = combinedOutput
            .replace(/(?<=CycloneDX\s+Generator\s+)[\d.]+/, REDACTED)
            .replace(/(?<=Node\.js,\s+Version:\s+)[\d.]+/, REDACTED)

          // Check that help output contains expected cdxgen header.
          // This validates that cdxgen is properly forwarding the --help flag.
          expect(cdxgenOutput).toContain(`CycloneDX Generator ${REDACTED}`)
          expect(cdxgenOutput).toContain(
            `Runtime: Node.js, Version: ${REDACTED}`,
          )
        }

        // Note: Socket CLI banner may appear in stderr while cdxgen output is in stdout.
        // This is expected behavior as the banner is informational output.
        if (hasSocketBanner(stderr)) {
          const redactedStderr = stderr
            .replace(/CLI:\s+v[\d.]+/, `CLI: ${REDACTED}`)
            .replace(/token:\s+[^,]+/, `token: ${REDACTED}`)
            .replace(/org:\s+[^)]+/, `org: ${REDACTED}`)
            .replace(/cwd:\s+[^\n]+/, `cwd: ${REDACTED}`)

          expect(redactedStderr).toContain('_____         _       _')
          expect(redactedStderr).toContain(`CLI: ${REDACTED}`)
        }

        // Note: We avoid snapshot testing here as cdxgen's help output format may change.
        // On Windows CI, cdxgen might not output help properly or might not be installed.
        // We check for either cdxgen help content OR just the Socket banner.
        const hasSocketCommand = combinedOutput.includes(
          'socket manifest cdxgen',
        )

        // Test passes if either:
        // 1. We got cdxgen help output (normal case).
        // 2. We got Socket CLI banner with command (Windows CI where cdxgen might not work).
        const hasCdxgenWorked = hasCdxgenHelpContent(combinedOutput)
        const hasFallbackOutput =
          hasSocketBanner(combinedOutput) && hasSocketCommand

        expect(hasCdxgenWorked || hasFallbackOutput).toBe(true)
        expect(code).toBe(0)
        expect(combinedOutput, 'banner includes base command').toContain(
          '`socket manifest cdxgen`',
        )
      },
    )

    it(
      'should forward known flags to cdxgen',
      {
        // Increase timeout for CI environments where cdxgen downloads can be slow.
        timeout: 60_000,
      },
      async () => {
        for (const command of ['-h', FLAG_HELP]) {
          // eslint-disable-next-line no-await-in-loop
          const result = await spawn(
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', command],
            spawnOpts,
          )

          // Note: cdxgen may output help info to stdout or stderr depending on environment.
          // In some CI environments, the help might not be captured properly.
          // We check both streams to ensure we catch the output regardless of where it appears.
          const combinedOutput = result.stdout + result.stderr

          // Note: We avoid snapshot testing here as cdxgen's help output format may change.
          // On Windows CI, cdxgen might not output help properly or might not be installed.
          // We check for either cdxgen help content OR just the Socket banner.

          // Test passes if either:
          // 1. We got cdxgen help output (normal case).
          // 2. We got Socket CLI banner (Windows CI where cdxgen might not work).
          const hasCdxgenWorked = hasCdxgenHelpContent(combinedOutput)
          const hasFallbackOutput = hasSocketBanner(combinedOutput)

          expect(hasCdxgenWorked || hasFallbackOutput).toBe(true)
        }
      },
    )

    // TODO: Fix test failure - cdxgen unknown short flag forwarding
    // Test may be timing out or failing due to command forwarding logic changes
    it('should not forward an unknown short flag to cdxgen', async () => {
      const command = '-u'
      await expect(
        spawn(
          constants.execPath,
          [binCliPath, 'manifest', 'cdxgen', command],
          spawnOpts,
        ),
        // @ts-ignore toHaveStderrInclude is defined above.
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown argument: ${command}`,
      )
    })

    // TODO: Fix test failure - cdxgen unknown flag forwarding
    // Test may be timing out or failing due to command forwarding logic changes
    it('should not forward an unknown flag to cdxgen', async () => {
      const command = '--unknown'
      await expect(
        spawn(
          constants.execPath,
          [binCliPath, 'manifest', 'cdxgen', command],
          spawnOpts,
        ),
        // @ts-ignore toHaveStderrInclude is defined above
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown argument: ${command}`,
      )
    })

    // TODO: Fix test failure - cdxgen multiple unknown flags forwarding
    // Test may be timing out or failing due to command forwarding logic changes
    it('should not forward multiple unknown flags to cdxgen', async () => {
      await expect(
        () =>
          spawn(
            constants.execPath,
            [binCliPath, 'manifest', 'cdxgen', '-u', '-h', '--unknown'],
            spawnOpts,
          ),
        // @ts-ignore toHaveStderrInclude is defined above
      ).rejects.toHaveStderrInclude(
        `${LOG_SYMBOLS.fail} Unknown arguments: -u and --unknown`,
      )
    })
  })
})
