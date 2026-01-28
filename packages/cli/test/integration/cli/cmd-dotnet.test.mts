/**
 * Integration tests for `socket dotnet` wrapper command.
 *
 * Tests the dotnet package manager wrapper that adds Socket security scanning
 * to .NET package operations via Socket Firewall (sfw). Commands are forwarded to
 * sfw which provides security scanning before installation.
 *
 * Test Coverage:
 * - Help text display and usage examples
 *
 * Security Features:
 * - Pre-installation security scanning via Socket Firewall
 *
 * Related Files:
 * - src/commands/dotnet/cmd-dotnet.mts - dotnet command implementation
 * - src/utils/dlx/resolve-binary.mts - sfw resolution
 */

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

const DOTNET = 'dotnet'

describe('socket dotnet', async () => {
  cmdit(
    [DOTNET, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Run dotnet with Socket Firewall security

          Usage
                $ socket dotnet ...
          
              Note: Everything after "dotnet" is forwarded to Socket Firewall (sfw).
                    Socket Firewall provides real-time security scanning for dotnet packages.
          
              Examples
                $ socket dotnet install Newtonsoft.Json
                $ socket dotnet restore
                $ socket dotnet list"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket dotnet\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket dotnet`')
    },
  )
})
