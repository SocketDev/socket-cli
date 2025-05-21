import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

const { CLI } = constants

describe('socket scan create', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['scan', 'create', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Create a scan

          Usage
            $ socket scan create [...options] <org> <TARGET> [TARGET...]

          API Token Requirements
            - Quota: 1 unit
            - Permissions: full-scans:create

          Uploads the specified "package.json" and lock files for JavaScript, Python,
          Go, Scala, Gradle, and Kotlin dependency manifests.
          If any folder is specified, the ones found in there recursively are uploaded.

          Supports globbing such as "**/package.json", "**/requirements.txt", etc.

          Ignores any file specified in your project's ".gitignore" and also has a
          sensible set of default ignores from the "ignore-by-default" module.

          TARGET should be a FILE or DIR that _must_ be inside the CWD.

          When a FILE is given only that FILE is targeted. Otherwise any eligible
          files in the given DIR will be considered.

          The --repo and --branch flags tell Socket to associate this Scan with that
          repo/branch. The names will show up on your dashboard on the Socket website.

          Note: for a first run you probably want to set --defaultBranch to indicate
                the default branch name, like "main" or "master".

          The "alerts page" (https://socket.dev/dashboard/org/YOURORG/alerts) will show
          the results from the last scan designated as the "pending head" on the branch
          configured on Socket to be the "default branch". When creating a scan the
          --setAsAlertsPage flag will default to true to update this. You can prevent
          this by using --no-setAsAlertsPage. This flag is ignored for any branch that
          is not designated as the "default branch". It is disabled when using --tmp.

          Options
            --branch          Branch name
            --commitHash      Commit hash
            --commitMessage   Commit message
            --committers      Committers
            --cwd             working directory, defaults to process.cwd()
            --defaultBranch   Set the default branch of the repository to the branch of this full-scan. Should only need to be done once, for example for the "main" or "master" branch.
            --help            Print this help
            --interactive     Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json            Output result as json
            --markdown        Output result as markdown
            --org             Force override the organization slug, overrides the default org from config
            --pullRequest     Commit hash
            --readOnly        Similar to --dry-run except it can read from remote, stops before it would create an actual report
            --repo            Repository name
            --report          Wait for the scan creation to complete, then basically run \`socket scan report\` on it
            --setAsAlertsPage When true and if this is the "default branch" then this Scan will be the one reflected on your alerts page. See help for details. Defaults to true.
            --tmp             Set the visibility (true/false) of the scan in your dashboard.

          Examples
            $ socket scan create FakeOrg .
            $ socket scan create --repo=test-repo --branch=main FakeOrg ./package.json"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan create\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan create`',
      )
    },
  )

  cmdit(
    [
      'scan',
      'create',
      'fakeorg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--config',
      '{"apiToken": "abc"}',
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
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan create\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
