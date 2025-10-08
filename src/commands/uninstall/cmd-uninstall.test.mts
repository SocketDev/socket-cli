import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket uninstall', async () => {
  const { binCliPath } = constants
  let testCwd: string

  beforeAll(async () => {
    testCwd = path.join(
      tmpdir(),
      `socket-uninstall-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
      const trash = (await import('trash')).default
      await trash(testCwd).catch(() => {})
    }
  })

  cmdit(
    ['uninstall', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "What can I help you with?

        Help Topics:
          scan       - Scan projects for vulnerabilities and security issues
          fix        - Auto-fix vulnerabilities and apply security patches
          pm         - Enhanced npm, npx, yarn, and pnpm wrappers
          pkg        - Analyze package security and get security scores
          org        - Manage organizations and repositories
          config     - CLI settings and configuration management
          env        - Environment variables for advanced configuration
          flags      - Global command-line flags and options
          ask        - Use plain English to interact with Socket
          all        - Complete list of all available commands
          quick      - Get started with Socket CLI in minutes

        Use: socket --help=<topic>

        \\ud83d\\udca1 Tip: Run in an interactive terminal for a better experience"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket uninstall`',
      )
    },
  )

  cmdit(
    ['uninstall', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testCwd,
      })
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`,
      )
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
})
