import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket repository del', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['repository', 'del', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Delete a repository in an organization

          Usage
            $ socket repository del [options] <REPO>

          API Token Requirements
            - Quota: 1 unit
            - Permissions: repo:delete

          Options
            --interactive       Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json              Output result as json
            --markdown          Output result as markdown
            --org               Force override the organization slug, overrides the default org from config

          Examples
            $ socket repository del test-repo"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repository del\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket repository del`',
      )
    },
  )

  cmdit(
    ['repository', 'del', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repository del\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          - Org name by default setting, --org, or auto-discovered (missing)

          - Repository name as first argument (missing)

          - You need to be logged in to use this command. See \`socket login\`. (missing Socket API token)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'repository',
      'del',
      'a',
      'b',
      '--org',
      'xyz',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: xyz
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repository del\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'repository',
      'del',
      'reponame',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}',
    ],
    'should report missing org name',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repository del\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          - Org name by default setting, --org, or auto-discovered (missing)

          - Repository name as first argument (ok)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'repository',
      'del',
      '--dry-run',
      '--config',
      '{"apiToken":"anything", "defaultOrg": "fakeorg"}',
    ],
    'should only report missing repo name with default org',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repository del\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          - Repository name as first argument (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'repository',
      'del',
      '--org',
      'forcedorg',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}',
    ],
    'should only report missing repo name with --org flag',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: forcedorg
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repository del\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          - Repository name as first argument (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'repository',
      'del',
      'fakerepo',
      '--dry-run',
      '--config',
      '{"apiToken":"anything", "defaultOrg": "fakeorg"}',
    ],
    'should run to dryrun',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repository del\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
