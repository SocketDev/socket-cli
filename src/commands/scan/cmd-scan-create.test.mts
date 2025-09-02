import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket scan create', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['scan', 'create', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
            --interactive       Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.
            --json              Output result as json
            --markdown          Output result as markdown
            --org               Force override the organization slug, overrides the default org from config
            --pull-request      Pull request number
            --reach             Run tier 1 full application reachability analysis
            --read-only         Similar to --dry-run except it can read from remote, stops before it would create an actual report
            --repo              Repository name
            --report            Wait for the scan creation to complete, then basically run \`socket scan report\` on it
            --set-as-alerts-page  When true and if this is the "default branch" then this Scan will be the one reflected on your alerts page. See help for details. Defaults to true.
            --tmp               Set the visibility (true/false) of the scan in your dashboard.

          Reachability Options (when --reach is used)
            --reach-analysis-memory-limit  The maximum memory in MB to use for the reachability analysis. The default is 8192MB.
            --reach-analysis-timeout  Set timeout for the reachability analysis. Split analysis runs may cause the total scan time to exceed this timeout significantly.
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
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
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
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, --org: fakeOrg
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan create\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-disable-analytics',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-disable-analytics is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-analysis-memory-limit',
      '8192',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when --reach-analysis-memory-limit is used with default value without --reach',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0 when using default value').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-analysis-memory-limit',
      '4096',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-analysis-memory-limit is used with non-default value without --reach',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-analysis-timeout',
      '3600',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-analysis-timeout is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-ecosystems',
      'npm',
      '--reach-ecosystems',
      'pypi',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-ecosystems is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-disable-analytics',
      '--reach-analysis-memory-limit',
      '4096',
      '--reach-analysis-timeout',
      '3600',
      '--reach-ecosystems',
      'npm',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when reachability options are used with --reach',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-exclude-paths',
      'node_modules',
      '--reach-exclude-paths',
      'dist',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-exclude-paths is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-disable-analytics',
      '--reach-analysis-memory-limit',
      '4096',
      '--reach-analysis-timeout',
      '3600',
      '--reach-ecosystems',
      'npm',
      '--reach-exclude-paths',
      'node_modules',
      '--reach-exclude-paths',
      'dist',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when all reachability options including reachExcludePaths are used with --reach',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-ecosystems',
      'npm,pypi,cargo',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when --reach-ecosystems is used with comma-separated values',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'should exit with code 0 when comma-separated values are used',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-exclude-paths',
      'node_modules,dist,build',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when --reach-exclude-paths is used with comma-separated values',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(
        code,
        'should exit with code 0 when comma-separated values are used',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-ecosystems',
      'npm,pypi',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-ecosystems with comma-separated values is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach-exclude-paths',
      'node_modules,dist',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-exclude-paths with comma-separated values is used without --reach',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Reachability analysis flags require --reach to be enabled',
      )
      expect(output).toContain('add --reach flag to use --reach-* options')
      expect(
        code,
        'should exit with non-zero code when validation fails',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-ecosystems',
      'npm,invalid-ecosystem',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when --reach-ecosystems contains invalid values',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Invalid ecosystem: "invalid-ecosystem"')
      expect(
        code,
        'should exit with non-zero code when invalid ecosystem is provided',
      ).not.toBe(0)
    },
  )

  cmdit(
    ['scann', 'create', '--help'],
    'should suggest similar command for typos',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      '/tmp',
      '--org',
      'test-org',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should show helpful error message for directories with no manifest files',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-analysis-memory-limit',
      '1',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with minimal positive reachability memory limit',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-analysis-timeout',
      '0',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with zero timeout (unlimited)',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-ecosystems',
      'npm,invalid,pypi',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when invalid ecosystem mixed with valid ones in --reach mode',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Invalid ecosystem: "invalid"')
      expect(
        code,
        'should exit with non-zero code when invalid ecosystem provided',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--reach-ecosystems',
      'npm',
      '--reach-exclude-paths',
      'vendor,build,dist,target',
      '--reach-analysis-memory-limit',
      '16384',
      '--reach-analysis-timeout',
      '7200',
      '--reach-disable-analytics',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with comprehensive reachability configuration',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0 when all flags are valid').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--json',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with --reach and --json output format',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--markdown',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed with --reach and --markdown output format',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--json',
      '--markdown',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when both --json and --markdown are used with --reach',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('The json and markdown flags cannot be both set')
      expect(
        code,
        'should exit with non-zero code when conflicting flags are used',
      ).not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'create',
      '--org',
      'fakeOrg',
      'target',
      '--dry-run',
      '--repo',
      'xyz',
      '--branch',
      'abc',
      '--reach',
      '--read-only',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should succeed when combining --reach with --read-only',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
