import path from 'node:path'

import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket organization list', async () => {
  const { binCliPath } = constants

  cmdit(
    ['organization', 'policy', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "usage: socketcli [-h] [--api-token <token>] [--repo <owner/repo>]
                         [--repo-is-public] [--branch <name>] [--integration <type>]
                         [--owner <name>] [--pr-number <number>]
                         [--commit-message <message>] [--commit-sha <sha>]
                         [--committers [<name> ...]] [--target-path <path>]
                         [--sbom-file <path>] [--license-file-name <string>]
                         [--save-submitted-files-list <path>]
                         [--save-manifest-tar <path>] [--files <json>]
                         [--sub-path <path>] [--workspace-name <name>]
                         [--excluded-ecosystems EXCLUDED_ECOSYSTEMS]
                         [--default-branch] [--pending-head] [--generate-license]
                         [--enable-debug] [--enable-json] [--enable-sarif]
                         [--disable-overview] [--exclude-license-details]
                         [--allow-unverified] [--disable-security-issue]
                         [--ignore-commit-files] [--disable-blocking] [--enable-diff]
                         [--scm <type>] [--timeout <seconds>]
                         [--include-module-folders] [--version]

        The Socket Security CLI will get the head scan for the provided repo from
        Socket, create a new one, and then report any alerts introduced by the
        changes. Any new alerts will cause the CLI to exit with a non-Zero exit code
        (1 for error alerts, 5 for warnings).

        options:
          -h, --help            show this help message and exit
          --version             show program's version number and exit

        Authentication:
          --api-token <token>   Socket Security API token (can also be set via
                                SOCKET_SECURITY_API_KEY env var)

        Repository:
          --repo <owner/repo>   Repository name in owner/repo format
          --repo-is-public      If set it will flag a new repository creation as
                                public. Defaults to false.
          --branch <name>       Branch name

        Integration:
          --integration <type>  Integration type of api, github, gitlab, azure, or
                                bitbucket. Defaults to api
          --owner <name>        Name of the integration owner, defaults to the socket
                                organization slug

        Pull Request and Commit:
          --pr-number <number>  Pull request number
          --commit-message <message>
                                Commit message
          --commit-sha <sha>    Commit SHA
          --committers [<name> ...]
                                Committer for the commit (comma separated)

        Path and File:
          --target-path <path>  Target path for analysis
          --sbom-file <path>    SBOM file path
          --license-file-name <string>
                                SBOM file path
          --save-submitted-files-list <path>
                                Save list of submitted file names to JSON file for
                                debugging purposes
          --save-manifest-tar <path>
                                Save all manifest files to a compressed tar.gz archive
                                with original directory structure
          --files <json>        Files to analyze (JSON array string)
          --sub-path <path>     Sub-path within target-path for manifest file scanning
                                (can be specified multiple times). All sub-paths will
                                be combined into a single workspace scan while
                                preserving git context from target-path
          --workspace-name <name>
                                Workspace name suffix to append to repository name
                                (repo-name-workspace_name)
          --excluded-ecosystems EXCLUDED_ECOSYSTEMS
                                List of ecosystems to exclude from analysis (JSON
                                array string)

        Branch and Scan Configuration:
          --default-branch      Make this branch the default branch
          --pending-head        If true, the new scan will be set as the branch's head
                                scan
          --include-module-folders
                                Enabling including module folders like node_modules

        Output Configuration:
          --generate-license    Generate license information
          --enable-debug        Enable debug logging
          --enable-json         Output in JSON format
          --enable-sarif        Enable SARIF output of results instead of table or
                                JSON format
          --disable-overview    Disable overview output
          --exclude-license-details
                                Exclude license details from the diff report (boosts
                                performance for large repos)

        Security Configuration:
          --allow-unverified    Allow unverified packages
          --disable-security-issue
                                Disable security issue checks

        Advanced Configuration:
          --ignore-commit-files
                                Ignore commit files
          --disable-blocking    Disable blocking mode
          --enable-diff         Enable diff mode even when using --integration api
                                (forces diff mode without SCM integration)
          --scm <type>          Source control management type
          --timeout <seconds>   Timeout in seconds for API requests"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket organization policy`',
      )
    },
  )

  cmdit(
    [
      'organization',
      'policy',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should support --dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           usage: socketcli [-h] [--api-token <token>] [--repo <owner/repo>]
                         [--repo-is-public] [--branch <name>] [--integration <type>]
                         [--owner <name>] [--pr-number <number>]
                         [--commit-message <message>] [--commit-sha <sha>]
                         [--committers [<name> ...]] [--target-path <path>]
                         [--sbom-file <path>] [--license-file-name <string>]
                         [--save-submitted-files-list <path>]
                         [--save-manifest-tar <path>] [--files <json>]
                         [--sub-path <path>] [--workspace-name <name>]
                         [--excluded-ecosystems EXCLUDED_ECOSYSTEMS]
                         [--default-branch] [--pending-head] [--generate-license]
                         [--enable-debug] [--enable-json] [--enable-sarif]
                         [--disable-overview] [--exclude-license-details]
                         [--allow-unverified] [--disable-security-issue]
                         [--ignore-commit-files] [--disable-blocking] [--enable-diff]
                         [--scm <type>] [--timeout <seconds>]
                         [--include-module-folders] [--version]
        socketcli: error: unrecognized arguments: --dry-run --config {"apiToken":"fakeToken"}
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization policy\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
