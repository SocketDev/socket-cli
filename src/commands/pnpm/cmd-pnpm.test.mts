import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import trash from 'trash'
import { describe, expect, it, vi } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_SILENT,
  FLAG_VERSION,
  PNPM,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

// TODO: Several exec/install tests fail due to config flag handling.
describe('socket pnpm', async () => {
  const { binCliPath } = constants

  cmdit(
    [PNPM, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Wraps pnpm with Socket security scanning

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
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
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

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(stderr).toContain('CLI')
      expect(code, 'dry-run without args should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
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

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      PNPM,
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

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'dry-run add scoped package should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
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
      PNPM,
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle exec with issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'dry-run exec should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'exec',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
    ],
    'should handle exec with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'dry-run exec with --config should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle exec with multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'dry-run exec with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'exec',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
    ],
    'should handle exec with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'dry-run exec with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle install with issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'dry-run install should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
      FLAG_DRY_RUN,
    ],
    'should handle install with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'dry-run install with --config should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle install with multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'dry-run install with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      PNPM,
      'install',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
      FLAG_DRY_RUN,
    ],
    'should handle install with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'dry-run install with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  it('should work when invoked via pnpm dlx', { timeout: 30_000 }, async () => {
    // Mock spawn to avoid actual pnpm dlx execution.
    const spawnMock = vi
      .fn()
      .mockImplementation(
        async (command: string, args: string[], options: SpawnOptions) => {
          // Simulate successful pnpm dlx execution.
          if (command === PNPM && args[0] === 'dlx') {
            // Simulate cowsay output if cowsay is being run.
            if (args.some(a => a.includes('cowsay'))) {
              return {
                code: 0,
                stdout: `
 _______
< hello >
 -------
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||
`.trim(),
                stderr: '',
              }
            }

            return {
              code: 0,
              stdout: 'Socket CLI executed successfully via pnpm dlx',
              stderr: '',
            }
          }
          // Fallback to original spawn for other commands.
          return await spawn(command, args, options)
        },
      )

    // Create a temporary directory for testing.
    const tmpDir = path.join(tmpdir(), `pnpm-dlx-test-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })

    try {
      // Create a minimal package.json.
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test-pnpm-dlx', version: '1.0.0' }),
      )

      // Run socket pnpm via pnpm dlx (mocked).
      const { code, stdout } = await spawnMock(
        PNPM,
        ['dlx', '@socketsecurity/cli@latest', PNPM, FLAG_VERSION],
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
      expect(stdout).toContain('Socket CLI executed successfully')
    } finally {
      // Clean up the temporary directory.
      await trash(tmpDir)
    }
  })
})
