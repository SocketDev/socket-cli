/**
 * Integration tests for `socket bundler` wrapper command.
 *
 * Tests the bundler package manager wrapper that adds Socket security scanning
 * to Ruby dependency operations via Socket Firewall (sfw). Commands are forwarded to
 * sfw which provides security scanning before installation.
 *
 * Test Coverage:
 * - Help text display and usage examples
 *
 * Security Features:
 * - Pre-installation security scanning via Socket Firewall
 *
 * Related Files:
 * - src/commands/bundler/cmd-bundler.mts - bundler command implementation
 * - src/utils/dlx/resolve-binary.mts - sfw resolution
 */

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

const BUNDLER = 'bundler'

describe('socket bundler', async () => {
  cmdit(
    [BUNDLER, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Run bundler with Socket Firewall security

          Usage
                $ socket bundler ...
          
              Note: Everything after "bundler" is forwarded to Socket Firewall (sfw).
                    Socket Firewall provides real-time security scanning for bundler packages.
          
              Examples
                $ socket bundler install
                $ socket bundler update
                $ socket bundler exec rake"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket bundler\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket bundler`',
      )
    },
  )
})
