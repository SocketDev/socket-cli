import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket scan github', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['scan', 'github', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Create a scan for given GitHub repo

          Usage
            $ socket scan github [options] [CWD=.]

          API Token Requirements
            - Quota: 1 unit
            - Permissions: full-scans:create

          This is similar to the \`socket scan create\` command except it pulls the files
          from GitHub. See the help for that command for more details.

          A GitHub Personal Access Token (PAT) will at least need read access to the repo
          ("contents", read-only) for this command to work.

          Note: This command cannot run the \`socket manifest auto\` things because that
          requires local access to the repo while this command runs entirely through the
          GitHub for file access.

          You can use \`socket scan setup\` to configure certain repo flag defaults.

          Options
            --all             Apply for all known repos reported by the Socket API. Supersedes \`repos\`.
            --githubApiUrl    Base URL of the GitHub API (default: https://api.github.com)
            --githubToken     (required) GitHub token for authentication (or set GITHUB_TOKEN as an environment variable)
            --interactive     Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json            Output result as json
            --markdown        Output result as markdown
            --org             Force override the organization slug, overrides the default org from config
            --orgGithub       Alternate GitHub Org if the name is different than the Socket Org
            --repos           List of repos to target in a comma-separated format (e.g., repo1,repo2). If not specified, the script will pull the list from Socket and ask you to pick one. Use --all to use them all.

          Examples
            $ socket scan github
            $ socket scan github ./proj"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan github\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan github`',
      )
    },
  )

  cmdit(
    ['scan', 'github', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan github\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

        \\xd7 Skipping auto-discovery of org in dry-run mode
        \\xd7  Input error:  Please review the input requirements and try again

          - This command requires an API token for access (missing (try \`socket login\`))

          - This command requires a GitHub API token for access (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'scan',
      'github',
      'fakeorg',
      '--dry-run',
      '--github-token',
      'fake',
      '--config',
      '{"apiToken":"anything"}',
      'x',
      'y',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan github\`, cwd: <redacted>

        \\u203c Unable to determine the target org. Trying to auto-discover it now...
        i Note: you can run \`socket login\` to set a default org. You can also override it with the --org flag.

        \\xd7 Skipping auto-discovery of org in dry-run mode"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
