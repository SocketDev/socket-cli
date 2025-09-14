import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { LOG_SYMBOLS } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  cleanOutput,
  cmdit,
  spawnPnpm,
  testPath,
} from '../../../test/utils.mts'
import constants from '../../constants.mts'

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
      ['manifest', 'cdxgen', '--help'],
      'should support --help',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd, {
          // Need to pass it on as env because --config will break cdxgen
          env: { SOCKET_CLI_CONFIG: '{}' },
        })

        const redactedStdout = stdout
          .replace(/(?<=CycloneDX\s+Generator\s+)[\d.]+/, '<redacted>')
          .replace(/(?<=Node\.js,\s+Version:\s+)[\d.]+/, '<redacted>')

        expect(redactedStdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
            |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest cdxgen\`, cwd: <redacted>

          npm error dev edges on non-top node
          npm error A complete log of this run can be found in: /Users/jdalton/.npm/_logs/2025-09-14T16_00_36_619Z-debug-0.log"
        `)

        // expect(code, 'explicit help should exit with code 0').toBe(0)
        expect(code, 'help should exit with code 2').toBe(0) // cdxgen special case
        expect(stderr, 'banner includes base command').toContain(
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
        for (const command of ['-h', '--help']) {
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
        `${LOG_SYMBOLS.fail} Unknown arguments: -u, --unknown`,
      )
    })
  })
})
