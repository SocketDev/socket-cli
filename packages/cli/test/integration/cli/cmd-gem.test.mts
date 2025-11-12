/**
 * Integration tests for `socket gem` wrapper command.
 *
 * Tests the gem package manager wrapper that adds Socket security scanning
 * to Ruby package operations via Socket Firewall (sfw). Commands are forwarded to
 * sfw which provides security scanning before installation.
 *
 * Test Coverage:
 * - Help text display and usage examples
 *
 * Security Features:
 * - Pre-installation security scanning via Socket Firewall
 *
 * Related Files:
 * - src/commands/gem/cmd-gem.mts - gem command implementation
 * - src/utils/dlx/resolve-binary.mts - sfw resolution
 */

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

const GEM = 'gem'

describe('socket gem', async () => {
  cmdit(
    [GEM, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Run gem with Socket Firewall security

          Usage
                $ socket gem ...
          
              Note: Everything after "gem" is forwarded to Socket Firewall (sfw).
                    Socket Firewall provides real-time security scanning for gem packages.
          
              Examples
                $ socket gem install rails
                $ socket gem list
                $ socket gem update"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket gem\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket gem`')
    },
  )
})
