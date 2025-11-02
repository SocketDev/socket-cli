import { describe, expect } from 'vitest'

import { NPM } from '@socketsecurity/lib/constants/agents'

import { expectDryRunOutput } from '../../../test/helpers/output-assertions.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_SILENT,
} from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket npm', async () => {
  cmdit(
    [NPM, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Wraps npm with Socket security scanning

          Usage
                $ socket npm ...
          
              API Token Requirements
                - Quota: 100 units
                - Permissions: packages:list
          
              Note: Everything after "npm" is passed to the npm command.
                    Only the \`--dry-run\` and \`--help\` flags are caught here.
          
              Use \`socket wrapper on\` to alias this command as \`npm\`.
          
              Examples
                $ socket npm
                $ socket npm install -g cowsay
                $ socket npm exec cowsay"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket npm\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket npm`')
    },
  )

  cmdit(
    [NPM, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
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
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket npm\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      FLAG_SILENT,
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle npm exec with version',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd)
      expect(code, 'dry-run exec should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npm exec with -c flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stdout)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'dry-run exec with -c should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
    ],
    'should handle npm exec with --config flag and issueRules for malware',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stdout)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'dry-run exec with --config should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npm exec with -c flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stdout)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'dry-run exec with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'npm',
      'exec',
      'cowsay@^1.6.0',
      'hello',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
    ],
    'should handle npm exec with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stdout)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'dry-run exec with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )
})
