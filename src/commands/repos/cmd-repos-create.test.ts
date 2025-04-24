import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket repos create', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['repos', 'create', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Create a repository in an organization

          Usage
            $ socket repos create <org slug> --repo-name=<name>

          API Token Requirements
            - Quota: 1 unit
            - Permissions: repo:create

          Options
            --defaultBranch   Repository default branch
            --help            Print this help
            --homepage        Repository url
            --interactive     Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --org             Force override the organization slug, overrides the default org from config
            --repoDescription Repository description
            --repoName        Repository name
            --visibility      Repository visibility (Default Private)

          Examples
            $ socket repos create FakeOrg --repoName=test-repo"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher."
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket repos create`'
      )
    }
  )

  cmdit(
    ['repos', 'create', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher.

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again\\x1b[22m

          - Org name must be the first argument (\\x1b[31mmissing\\x1b[39m)

          - Repository name using --repoName (\\x1b[31mmissing\\x1b[39m)

          - You need to be logged in to use this command. See \`socket login\`. (\\x1b[31mmissing API token\\x1b[39m)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'repos',
      'create',
      'a',
      '--repoName',
      'b',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}'
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher."
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )

  cmdit(
    [
      'repos',
      'create',
      'reponame',
      '--dry-run',
      '--config',
      '{"isTestingV1": true, "apiToken":"anything"}'
    ],
    'should report missing org name in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted> (is testing v1)
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher.
        \\x1b[32m   (Thank you for testing the v1 bump! Please send us any feedback you might have!)
        \\x1b[39m
        Missing the org slug and no --org flag set. Trying to auto-discover the org now...
        Note: you can set the default org slug to prevent this issue. You can also override all that with the --org flag.
        \\x1b[31m\\xd7\\x1b[39m Skipping auto-discovery of org in dry-run mode
        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again\\x1b[22m

          - Org name by default setting, --org, or auto-discovered (\\x1b[31mmissing\\x1b[39m)

          - Repository name as first argument (\\x1b[32mok\\x1b[39m)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'repos',
      'create',
      '--dry-run',
      '--config',
      '{"isTestingV1": true, "apiToken":"anything", "defaultOrg": "fakeorg"}'
    ],
    'should only report missing repo name with default org in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted> (is testing v1)
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>, default org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher.
        \\x1b[32m   (Thank you for testing the v1 bump! Please send us any feedback you might have!)
        \\x1b[39m
        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again\\x1b[22m

          - Repository name as first argument (\\x1b[31mmissing\\x1b[39m)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'repos',
      'create',
      '--org',
      'forcedorg',
      '--dry-run',
      '--config',
      '{"isTestingV1": true, "apiToken":"anything"}'
    ],
    'should only report missing repo name with --org flag in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted> (is testing v1)
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher.
        \\x1b[32m   (Thank you for testing the v1 bump! Please send us any feedback you might have!)
        \\x1b[39m
        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again\\x1b[22m

          - Repository name as first argument (\\x1b[31mmissing\\x1b[39m)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'repos',
      'create',
      'fakerepo',
      '--dry-run',
      '--config',
      '{"isTestingV1": true, "apiToken":"anything", "defaultOrg": "fakeorg"}'
    ],
    'should run to dryrun in v1',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted> (is testing v1)
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>, default org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket repos create\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher.
        \\x1b[32m   (Thank you for testing the v1 bump! Please send us any feedback you might have!)
        \\x1b[39m"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
