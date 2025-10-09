import { tmpdir } from 'node:os'
import path from 'node:path'

import { deleteAsync } from 'del'
import { afterAll, beforeAll, describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_SILENT,
  NPX,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket npx', async () => {
  const { binCliPath } = constants
  let testCwd: string

  beforeAll(async () => {
    // Create isolated temp directory for test execution
    testCwd = path.join(
      tmpdir(),
      `socket-npx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const { promises: fs } = await import('node:fs')
    await fs.mkdir(testCwd, { recursive: true })
    await fs.writeFile(
      path.join(testCwd, 'package.json'),
      JSON.stringify({ name: 'test', version: '1.0.0', private: true }),
    )
  })

  afterAll(async () => {
    if (testCwd) {
      await deleteAsync(testCwd).catch(() => {})
    }
  })

  cmdit(
    [NPX, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "Wraps npx with Socket security scanning

          Usage
            $ socket npx ...

          API Token Requirements
                  - Quota: 100 units
            - Permissions: packages:list

          Note: Everything after "npx" is passed to the npx command.
                Only the \`--dry-run\` and \`--help\` flags are caught here.

          Use \`socket wrapper on\` to alias this command as \`npx\`.

          Examples
            $ socket npx cowsay
            $ socket npx cowsay@1.6.0 hello"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket npx`')
    },
  )

  cmdit(
    [NPX, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      FLAG_SILENT,
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle npx with version',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(code, 'dry-run npx should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npx with -c flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'dry-run npx with -c should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npx with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'dry-run npx with --config should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npx with -c flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'dry-run npx with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'npx',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npx with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'dry-run npx with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )
})
