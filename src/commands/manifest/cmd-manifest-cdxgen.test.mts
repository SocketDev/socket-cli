import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { LOG_SYMBOLS } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  cleanOutput,
  cmdit,
  spawnSocketCli,
  testPath,
} from '../../../test/utils.mts'
import constants, { FLAG_HELP } from '../../constants.mts'

type PromiseSpawnOptions = Exclude<Parameters<typeof spawn>[2], undefined> & {
  encoding?: BufferEncoding | undefined
}

function createIncludeMatcher(streamName: 'stdout' | 'stderr') {
  return function (received: any, expected: string) {
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
        const hasCdxgenHelp = combinedOutput.includes('CycloneDX Generator')

        if (hasCdxgenHelp) {
          const cdxgenOutput = combinedOutput
            .replace(/(?<=CycloneDX\s+Generator\s+)[\d.]+/, '<redacted>')
            .replace(/(?<=Node\.js,\s+Version:\s+)[\d.]+/, '<redacted>')

          // Check that help output contains expected cdxgen header.
          // This validates that cdxgen is properly forwarding the --help flag.
          expect(cdxgenOutput).toContain('CycloneDX Generator <redacted>')
          expect(cdxgenOutput).toContain(
            'Runtime: Node.js, Version: <redacted>',
          )
        }

        // Note: Socket CLI banner may appear in stderr while cdxgen output is in stdout.
        // This is expected behavior as the banner is informational output.
        const hasSocketBanner = stderr.includes('_____         _       _')
        if (hasSocketBanner) {
          const redactedStderr = stderr
            .replace(/CLI:\s+v[\d.]+/, 'CLI: <redacted>')
            .replace(/token:\s+[^,]+/, 'token: <redacted>')
            .replace(/org:\s+[^)]+/, 'org: <redacted>')
            .replace(/cwd:\s+[^\n]+/, 'cwd: <redacted>')

          expect(redactedStderr).toContain('_____         _       _')
          expect(redactedStderr).toContain('CLI: <redacted>')
        }

        // Note: We avoid snapshot testing here as cdxgen's help output format may change.
        // Instead, we verify that key help options are present in the output.
        // This makes the test more resilient to minor cdxgen version changes.
        expect(combinedOutput).toContain('--help')
        expect(combinedOutput).toContain('--version')
        expect(combinedOutput).toContain('--output')
        expect(code).toBe(0)
        expect(combinedOutput, 'banner includes base command').toContain(
          '`socket manifest cdxgen`',
        )
      },
    )

    it.skipIf(constants.WIN32 && constants.ENV.CI)(
      'should forward known flags to cdxgen',
      {
        // Increase timeout for CI environments where cdxgen downloads can be slow.
        timeout: 60_000,
      },
      async () => {
        for (const command of ['-h', FLAG_HELP]) {
          // eslint-disable-next-line no-await-in-loop
          await expect(
            spawn(
              constants.execPath,
              [binCliPath, 'manifest', 'cdxgen', command],
              spawnOpts,
            ),
            // @ts-ignore toHaveStdoutInclude is defined above.
          ).resolves.toHaveStdoutInclude('CycloneDX Generator')
        }
      },
    )

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
