import path from 'node:path'

import { describe, expect } from 'vitest'

import {
  constants,
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_ORG,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/scan/create')

describe('socket scan create', async () => {
  const { binCliPath } = constants

  cmdit(
    ['scan', 'create', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Create a new Socket scan and report

          Usage
            $ socket scan create [options] [TARGET...]

          API Token Requirements
            - Quota: 1 unit
            - Permissions: full-scans:create

          Options
            --auto-manifest     Run \`socket manifest auto\` before collecting manifest files. This is necessary for languages like Scala, Gradle, and Kotlin, See \`socket manifest auto --help\`.
            --branch            Branch name
            --commit-hash       Commit hash
            --commit-message    Commit message
            --committers        Committers
            --cwd               working directory, defaults to process.cwd()
            --default-branch    Set the default branch of the repository to the branch of this full-scan. Should only need to be done once, for example for the "main" or "master" branch.
            --exclude-paths     List of glob patterns to exclude from the scan, including SCA/SBOM manifest discovery and (when --reach is enabled) Tier 1 reachability analysis. Patterns are matched relative to the project root. Bare directory names are auto-extended to recursive globs (e.g. \`tests\` becomes \`tests/**\`). Trailing slashes are stripped. Negation patterns (\`!path\`) are not supported. Accepts a comma-separated value or multiple flags.
            --interactive       Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json              Output as JSON
            --markdown          Output as Markdown
            --org               Force override the organization slug, overrides the default org from config
            --pull-request      Pull request number
            --reach             Run tier 1 full application reachability analysis
            --read-only         Similar to --dry-run except it can read from remote, stops before it would create an actual report
            --repo              Repository name
            --report            Wait for the scan creation to complete, then basically run \`socket scan report\` on it
            --report-level      Which policy level alerts should be reported (default 'error')
            --set-as-alerts-page  When true and if this is the "default branch" then this Scan will be the one reflected on your alerts page. See help for details. Defaults to true.
            --tmp               Set the visibility (true/false) of the scan in your dashboard.

          Reachability Options (when --reach is used)
            --reach-analysis-memory-limit  The maximum memory in MB to use for the reachability analysis. The default is 8192MB.
            --reach-analysis-timeout  Set timeout for the reachability analysis. Split analysis runs may cause the total scan time to exceed this timeout significantly.
            --reach-concurrency  Set the maximum number of concurrent reachability analysis runs. It is recommended to choose a concurrency level that ensures each analysis run has at least the --reach-analysis-memory-limit amount of memory available. NPM reachability analysis does not support concurrent execution, so the concurrency level is ignored for NPM.
            --reach-debug       Enable debug mode for reachability analysis. Provides verbose logging from the reachability CLI.
            --reach-disable-analysis-splitting  Limits Coana to at most 1 reachability analysis run per workspace.
            --reach-disable-analytics  Disable reachability analytics sharing with Socket. Also disables caching-based optimizations.
            --reach-ecosystems  List of ecosystems to conduct reachability analysis on, as either a comma separated value or as multiple flags. Defaults to all ecosystems.
            --reach-exclude-paths  List of paths to exclude from reachability analysis, as either a comma separated value or as multiple flags.
            --reach-skip-cache  Skip caching-based optimizations. By default, the reachability analysis will use cached configurations from previous runs to speed up the analysis.

          Uploads the specified dependency manifest files for Go, Gradle, JavaScript,
          Kotlin, Python, and Scala. Files like "package.json" and "requirements.txt".
          If any folder is specified, the ones found in there recursively are uploaded.

          Details on TARGET:

          - Defaults to the current dir (cwd) if none given
          - Multiple targets can be specified
          - If a target is a file, only that file is checked
          - If it is a dir, the dir is scanned for any supported manifest files
          - Dirs MUST be within the current dir (cwd), you can use --cwd to change it
          - Supports globbing such as "**/package.json", "**/requirements.txt", etc.
          - Ignores any file specified in your project's ".gitignore"
          - Also a sensible set of default ignores from the "ignore-by-default" module

          The --repo and --branch flags tell Socket to associate this Scan with that
          repo/branch. The names will show up on your dashboard on the Socket website.

          Note: for a first run you probably want to set --default-branch to indicate
                the default branch name, like "main" or "master".

          The "alerts page" (https://socket.dev/dashboard/org/YOURORG/alerts) will show
          the results from the last scan designated as the "pending head" on the branch
          configured on Socket to be the "default branch". When creating a scan the
          --set-as-alerts-page flag will default to true to update this. You can prevent
          this by using --no-set-as-alerts-page. This flag is ignored for any branch that
          is not designated as the "default branch". It is disabled when using --tmp.

          You can use \`socket scan setup\` to configure certain repo flag defaults.

          Examples
            $ socket scan create
            $ socket scan create ./proj --json
            $ socket scan create --repo=test-repo --branch=main ./package.json"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
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
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
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
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan create\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'target',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--exclude-paths',
      'tests',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when --exclude-paths is used without --reach',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'should exit with code 0 when --exclude-paths is used standalone',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      FLAG_ORG,
      'fakeOrg',
      'test/fixtures/commands/scan/reach/npm',
      FLAG_DRY_RUN,
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--exclude-paths',
      'tests',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when --exclude-paths is used with --reach',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
    },
  )

  cmdit(
    ['scann', 'create', FLAG_HELP],
    'should suggest similar command for typos',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Unknown command "scann". Did you mean "scan"?')
      expect(
        code,
        'should exit with non-zero code when command is not found',
      ).toBe(2)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      path.join(fixtureBaseDir, 'nonexistent'),
      FLAG_ORG,
      'test-org',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show helpful error message for directories with no manifest files',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('found no eligible files to scan')
      expect(output).toContain('docs.socket.dev')
      expect(output).toContain('manifest-file-detection-in-socket')
      expect(
        code,
        'should exit with non-zero code when no files found',
      ).not.toBe(0)
    },
  )
})
