/**
 * Integration tests for `socket pip` and `socket pip3` wrapper commands.
 *
 * Tests the pip package manager wrapper that adds Socket security scanning
 * to Python package operations via Socket Firewall (sfw). Commands are forwarded to
 * sfw which provides security scanning before installation.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - pip and pip3 alias support
 * - Dry-run behavior validation
 * - pip install operations with scanning
 * - Config flag variants
 * - Issue rules configuration
 *
 * Security Features:
 * - Pre-installation security scanning via Socket Firewall
 * - Malware detection integration
 *
 * Related Files:
 * - src/commands/pip/cmd-pip.mts - pip command implementation
 * - src/utils/dlx/resolve-binary.mjs - sfw resolution
 * - test/integration/cli/cmd-pip-malware.test.mts - Malware tests
 */

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

const PIP = 'pip'
const PIP3 = 'pip3'

describe('socket pip', async () => {
  cmdit(
    [PIP, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Run pip with Socket Firewall security

          Usage
                $ socket pip ...

              Note: Everything after "pip" is forwarded to Socket Firewall (sfw).
                    Socket Firewall provides real-time security scanning for pip packages.

              Examples
                $ socket pip install flask
                $ socket pip install -r requirements.txt
                $ socket pip list"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket pip\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket pip`')
    },
  )
})

describe('socket pip3', async () => {
  cmdit(
    [PIP3, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Run pip with Socket Firewall security

          Usage
                $ socket pip ...

              Note: Everything after "pip" is forwarded to Socket Firewall (sfw).
                    Socket Firewall provides real-time security scanning for pip packages.

              Examples
                $ socket pip install flask
                $ socket pip install -r requirements.txt
                $ socket pip list"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket pip\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket pip`')
    },
  )
})
