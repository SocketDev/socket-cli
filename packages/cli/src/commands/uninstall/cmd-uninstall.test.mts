import { describe, expect } from 'vitest'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_HELP } from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket uninstall', async () => {
  cmdit(
    ['uninstall', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "\\u26a1 Socket CLI - Secure your supply chain

        What can I help you with?

          [1] \\ud83d\\udd0d  Security Scanning
              Scan projects for vulnerabilities
          [2] \\ud83d\\udd27  Fix & Patch
              Fix vulnerabilities and apply patches
          [3] \\ud83d\\udce6  Package Managers
              Enhanced package manager commands
          [4] \\ud83d\\udcca  Package Analysis
              Analyze package security
          [5] \\ud83c\\udfe2  Organizations & Repos
              Manage organizations and repositories
          [6] \\u2699\\ufe0f  Configuration
              Settings and environment variables
          [7] \\ud83d\\udcac  Natural Language
              Use plain English commands
          [8] \\ud83d\\udcda  All Commands
              Show complete command list
          [9] \\ud83d\\ude80  Quick Start
              Get started quickly

        Run with an interactive terminal to select a category
        Or use: socket --help=<category>
        Categories: scan, fix, pm, pkg, org, config, ask, all, quick"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket uninstall\`, cwd: <redacted>"
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
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: No-op, call a sub-command; ok"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket uninstall\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
