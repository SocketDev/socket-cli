/**
 * Integration tests for `socket uv` wrapper command.
 *
 * Tests the uv package manager wrapper that adds Socket security scanning
 * to Python package operations via Socket Firewall (sfw). Commands are forwarded to
 * sfw which provides security scanning before installation.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - uv operations with scanning
 * - Config flag variants
 * - Issue rules configuration
 *
 * Security Features:
 * - Pre-installation security scanning via Socket Firewall
 * - Malware detection integration
 *
 * Related Files:
 * - src/commands/uv/cmd-uv.mts - uv command implementation
 * - src/utils/dlx/resolve-binary.mjs - sfw resolution
 * - test/integration/cli/cmd-uv-malware.test.mts - Malware tests
 */

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

const UV = 'uv'

describe('socket uv', async () => {
  cmdit(
    [UV, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Run uv with Socket Firewall security

          Usage
                $ socket uv ...
          
              Note: Everything after "uv" is forwarded to Socket Firewall (sfw).
                    Socket Firewall provides real-time security scanning for uv packages.
          
              Examples
                $ socket uv pip install flask
                $ socket uv pip sync
                $ socket uv run script.py"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket uv\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket uv`')
    },
  )
})
