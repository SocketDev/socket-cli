import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import trash from 'trash'
import { describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_SILENT,
  PNPM,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

// TODO: Revisit after socket-registry dep is updated.
describe.skip('socket pnpm', async () => {
  const { binCliPath } = constants

  cmdit(
    [PNPM, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Run pnpm with the Socket wrapper

          Usage
            $ socket pnpm ...

          API Token Requirements
            (none)

          Note: Everything after "pnpm" is passed to the pnpm command.
                Only the \`--dry-run\` and \`--help\` flags are caught here.

          Use \`socket wrapper on\` to alias this command as \`pnpm\`.

          Examples
            $ socket pnpm
            $ socket pnpm install
            $ socket pnpm add package-name
            $ socket pnpm dlx package-name"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket pnpm\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket pnpm`')
    },
  )

  cmdit(
    [PNPM, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(stderr).toContain('Socket.dev CLI')
      expect(code, 'dry-run without args should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'add',
      'lodash',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle add with --dry-run flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(code, 'dry-run add should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [PNPM, 'install', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should handle install with --dry-run flag',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run install should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'add',
      '@types/node@^20.0.0',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle scoped packages with version',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(code, 'dry-run add scoped package should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'dlx',
      FLAG_SILENT,
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle dlx with version',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run dlx should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'exec',
      '-c',
      '{"issueRules":{"malware":true}}',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle exec with -c flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(code, 'dry-run exec with -c should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'exec',
      FLAG_CONFIG,
      '{"issueRules":{"malware":true}}',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle exec with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(code, 'dry-run exec with --config should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'exec',
      '-c',
      '{"issueRules":{"malware":true,"gptMalware":true}}',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle exec with -c flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(
        code,
        'dry-run exec with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'exec',
      FLAG_CONFIG,
      '{"issueRules":{"malware":true,"gptMalware":true}}',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle exec with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(
        code,
        'dry-run exec with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'install',
      '-c',
      '{"issueRules":{"malware":true}}',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle install with -c flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(code, 'dry-run install with -c should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'install',
      FLAG_CONFIG,
      '{"issueRules":{"malware":true}}',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle install with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(
        code,
        'dry-run install with --config should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'install',
      '-c',
      '{"issueRules":{"malware":true,"gptMalware":true}}',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle install with -c flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(
        code,
        'dry-run install with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'install',
      FLAG_CONFIG,
      '{"issueRules":{"malware":true,"gptMalware":true}}',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle install with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(
        code,
        'dry-run install with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  it.skip(
    'should work when invoked via pnpm dlx',
    { timeout: 90_000 },
    async () => {
      // Create a temporary directory for testing.
      const tmpDir = path.join(tmpdir(), `pnpm-dlx-test-${Date.now()}`)
      await fs.mkdir(tmpDir, { recursive: true })

      try {
        // Create a minimal package.json.
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify({ name: 'test-pnpm-dlx', version: '1.0.0' }),
        )

        // Run socket pnpm via pnpm dlx.
        const { code, stderr, stdout } = await spawn(
          'pnpm',
          [
            'dlx',
            '@socketsecurity/cli@latest',
            'pnpm',
            'install',
            FLAG_CONFIG,
            '{"apiToken":"fakeToken"}',
          ],
          {
            cwd: tmpDir,
            env: {
              ...process.env,
              SOCKET_CLI_ACCEPT_RISKS: '1',
            },
            timeout: 60_000,
          },
        )

        // Check that the command succeeded.
        expect(code, 'pnpm dlx socket pnpm should exit with code 0').toBe(0)

        // Verify pnpm-lock.yaml was created.
        const lockfilePath = path.join(tmpDir, 'pnpm-lock.yaml')
        expect(
          existsSync(lockfilePath),
          'pnpm-lock.yaml should be created',
        ).toBe(true)
      } finally {
        // Clean up the temporary directory.
        await trash(tmpDir)
      }
    },
  )
})
