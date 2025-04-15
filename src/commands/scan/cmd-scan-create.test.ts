import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

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

          Note: --pendingHead is enabled by default and makes a scan show up in your
                dashboard. You can use \`--no-pendingHead\` to have it not show up.

          Options
            --branch          Branch name
            --commitHash      Commit hash
            --commitMessage   Commit message
            --committers      Committers
            --cwd             working directory, defaults to process.cwd()
            --defaultBranch   Set the default branch of the repository to the branch of this full-scan. Should only need to be done once, for example for the "main" or "master" branch.
            --help            Print this help
            --json            Output result as json
            --markdown        Output result as markdown
            --pendingHead     Designate this full-scan as the latest scan of a given branch. This must be set to have it show up in the dashboard.
            --pullRequest     Commit hash
            --readOnly        Similar to --dry-run except it can read from remote, stops before it would create an actual report
            --repo            Repository name
            --report          Wait for the scan creation to complete, then basically run \`socket scan report\` on it
            --tmp             Set the visibility (true/false) of the scan in your dashboard. Can not be used when --pendingHead is set.

          Examples
            $ socket scan create --repo=test-repo --branch=main FakeOrg ./package.json"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan create\`, cwd: <redacted>"
    `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan create`'
      )
    }
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
      '{"apiToken": "abc"}'
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | . |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan create\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
