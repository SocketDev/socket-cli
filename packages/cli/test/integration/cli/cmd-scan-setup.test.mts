/**
 * Integration tests for `socket scan setup` command.
 *
 * Tests configuring scan settings for projects.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - Socket.json creation/modification
 * - Scan configuration options
 *
 * Related Files:
 * - src/commands/scan/cmd-scan-setup.mts - Command definition
 * - src/commands/scan/handle-scan-setup.mts - Setup logic
 */

import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { expectDryRunOutput } from '../../helpers/output-assertions.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket scan setup', async () => {
  cmdit(
    ['scan', 'setup', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Start interactive configurator to customize default flag values for \`socket scan\` in this dir

          Usage
                $ socket scan setup [options] [CWD=.]
          
              Options
                --default-on-read-error  If reading the socket.json fails, just use a default config? Warning: This might override the existing json file!
          
              Interactive configurator to create a local json file in the target directory
              that helps to set flag defaults for \`socket scan create\`.
          
              This helps to configure the (Socket reported) repo and branch names, as well
              as which branch name is the "default branch" (main, master, etc). This way
              you don't have to specify these flags when creating a scan in this dir.
          
              This generated configuration file will only be used locally by the CLI. You
              can commit it to the repo (useful for collaboration) or choose to add it to
              your .gitignore all the same. Only this CLI will use it.
          
              Examples
          
                $ socket scan setup
                $ socket scan setup ./proj"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket scan setup\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan setup`',
      )
    },
  )

  cmdit(
    [
      'scan',
      'setup',
      'fakeOrg',
      'scanidee',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stdout)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket scan setup\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
