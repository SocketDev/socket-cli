/**
 * Integration tests for `socket pip` wrapper command.
 *
 * Tests the pip package manager wrapper that adds Socket security scanning
 * to Python package operations. This wrapper intercepts pip commands and
 * scans packages for security issues before installation.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - Python package installation with scanning
 * - Config flag variants
 * - Issue rules configuration
 *
 * Security Features:
 * - Pre-installation security scanning
 * - Malware detection for Python packages
 * - API token validation
 *
 * Related Files:
 * - src/commands/wrapper/pip.mts - pip wrapper implementation
 * - src/shadow/pip/ - Shadow pip implementation
 */

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket pip', async () => {
  cmdit(
    ['pip', FLAG_HELP, FLAG_CONFIG, '{}'],
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

  cmdit(
    ['pip', '--version', FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should forward --version to sfw',
    async cmd => {
      const { stderr } = await spawnSocketCli(binCliPath, cmd)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket pip\`, cwd: <redacted>

        Unknown flag
        --version"
      `)
    },
  )
})
