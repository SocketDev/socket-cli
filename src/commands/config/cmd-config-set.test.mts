import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket config get', async () => {
  const { binCliPath } = constants

  cmdit(
    ['config', 'set', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Update the value of a local CLI config item

          Usage
            $ socket config set [options] <KEY> <VALUE>

          Options
            --json              Output as JSON
            --markdown          Output as Markdown

          This is a crude way of updating the local configuration for this CLI tool.

          Note that updating a value here is nothing more than updating a key/value
          store entry. No validation is happening. The server may reject your values
          in some cases. Use at your own risk.

          Note: use \`socket config unset\` to restore to defaults. Setting a key
          to \`undefined\` will not allow default values to be set on it.

          Keys:

           - apiBaseUrl -- Base URL of the Socket API endpoint
           - apiProxy -- A proxy through which to access the Socket API
           - apiToken -- The Socket API token required to access most Socket API endpoints
           - defaultOrg -- The default org slug to use; usually the org your Socket API token has access to. When set, all orgSlug arguments are implied to be this value.
           - enforcedOrgs -- Orgs in this list have their security policies enforced on this machine
           - org -- Alias for defaultOrg
           - skipAskToPersistDefaultOrg -- This flag prevents the Socket CLI from asking you to persist the org slug when you selected one interactively

          Examples
            $ socket config set apiProxy https://example.com"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config set\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config set`',
      )
    },
  )

  cmdit(
    ['config', 'set', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config set\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Config key should be the first arg (missing)
          \\xd7 Key value should be the remaining args (use \`unset\` to unset a value) (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'config',
      'set',
      'test',
      'xyz',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config set\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    ['config', 'set', 'defaultOrg', 'my-test-org', FLAG_CONFIG, '{}'],
    'should fail (not report OK) when a full config override prevents persisting',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // A full --config override makes the config read-only, so the value cannot
      // be saved. `config set` is a no-op here, so it must fail rather than
      // report a misleading "OK".
      const combined = `${stdout}\n${stderr}`
      expect(combined).toContain('was not saved')
      expect(stdout).not.toContain('OK')
      expect(code, 'an unpersistable set should exit non-zero').toBe(1)
    },
  )

  cmdit(
    ['config', 'set', 'defaultOrg', 'my-test-org'],
    'should persist a non-token key when only the API token is overridden via env',
    async cmd => {
      // Isolate the config file via XDG_DATA_HOME so the test never writes to
      // the real user config. NOTE: socketAppDataPath only honors XDG_DATA_HOME
      // on macOS/Linux; on Windows it uses LOCALAPPDATA, so this isolation (and
      // thus the test) assumes a POSIX runner. CI is Linux-only today.
      const dataHome = mkdtempSync(path.join(os.tmpdir(), 'socket-cfg-'))
      try {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
          env: {
            SOCKET_SECURITY_API_TOKEN: 'sktsec_faketoken',
            XDG_DATA_HOME: dataHome,
          },
        })
        expect(code, 'a persistable set should exit 0').toBe(0)
        expect(stdout).toContain('OK')

        const raw = readFileSync(
          path.join(dataHome, 'socket', 'settings', 'config.json'),
          'utf8',
        )
        const saved = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
        expect(saved.defaultOrg).toBe('my-test-org')
        // The env token must never be written to disk.
        expect(saved.apiToken).toBeUndefined()
      } finally {
        rmSync(dataHome, { recursive: true, force: true })
      }
    },
  )
})
