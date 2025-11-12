/**
 * Integration tests for `socket go` wrapper command.
 *
 * Tests the go package manager wrapper that adds Socket security scanning
 * to Go module operations via Socket Firewall (sfw). Commands are forwarded to
 * sfw which provides security scanning before installation.
 *
 * Test Coverage:
 * - Help text display and usage examples
 *
 * Security Features:
 * - Pre-installation security scanning via Socket Firewall
 *
 * Related Files:
 * - src/commands/go/cmd-go.mts - go command implementation
 * - src/utils/dlx/resolve-binary.mts - sfw resolution
 */

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

const GO = 'go'

describe('socket go', async () => {
  cmdit(
    [GO, FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Run go with Socket Firewall security

          Usage
                $ socket go ...
          
              Note: Everything after "go" is forwarded to Socket Firewall (sfw).
                    Socket Firewall provides real-time security scanning for go packages.
                    Wrapper mode works best on Linux (macOS may have keychain issues).
          
              Examples
                $ socket go get github.com/gin-gonic/gin
                $ socket go install golang.org/x/tools/cmd/goimports
                $ socket go mod download"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket go\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket go`')
    },
  )
})
