# `socket fix`

Find vulnerable dependencies and calculate upgrades for the current project.
The Socket API token needs the `fixes:list`, `full-scans:create`, and
`packages:list` permissions.

In local mode, preview fixes or apply them to your working directory.

```sh
# Preview fixes for all vulnerabilities
socket fix --all --no-apply-fixes

# Apply fixes for all vulnerabilities
socket fix --all

# Apply a fix for a specific vulnerability in another directory
socket fix ./path/to/project --id CVE-2021-23337
```

`--no-apply-fixes` only affects local mode. Use either `--all` or `--id`. The
`--id` flag accepts CVE IDs, GHSA IDs, or package URLs (PURLs). A bare
`socket fix` still processes all vulnerabilities in local mode and prints a
deprecation warning.

To open GitHub pull requests from CI, set these variables.

- `CI`
- `SOCKET_CLI_GITHUB_TOKEN` or `GITHUB_TOKEN`
- `SOCKET_CLI_GIT_USER_NAME`
- `SOCKET_CLI_GIT_USER_EMAIL`

The command also needs to resolve the repository from `GITHUB_REPOSITORY` or
the Git remote named `origin`. If any of the listed CI variables are missing,
the command runs in local mode. Use `--autopilot` to enable auto-merge for
pull requests the command opens.

Run `socket fix --help` for options to filter ecosystems and package managers,
limit version changes, or choose how version ranges are updated.
