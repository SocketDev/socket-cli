# Dependency health and fixes

## `socket doctor`

Check dependency health policies and repository practices:

```sh
socket doctor
```

On pnpm workspaces, the command enforces a seven-day `minimumReleaseAge` in
`pnpm-workspace.yaml`. It can add or raise that setting. It also reports
workflow, Socket Firewall, and phantom dependency findings. Other package
managers do not support this soak-time setting.

## `socket optimize`

Analyze dependencies against Socket Registry overrides, then update
`package.json` and run the package manager to install the overrides:

```sh
socket optimize
```

Use `--dry-run` to preview the file and package-manager actions. `--pin` selects
fixed override versions. `--prod` limits overrides to production dependencies.

## `socket fix`

Find dependency updates that address vulnerabilities:

```sh
socket fix ./project --id CVE-2021-23337
```

Use `--id` for advisory IDs or PURLs and `--all` to process all discovered
vulnerabilities in local mode. Local mode applies fixes by default. Pass
`--no-apply-fixes` to compute and report proposed upgrades without applying
them. In CI mode, the command can create pull requests; `--pr-limit` sets the
maximum number.

## `socket ask`

Describe a task in plain English. The command proposes a CLI action and runs it
only when you pass `--execute`:

```sh
socket ask "scan for vulnerabilities"
socket ask "fix critical issues" --execute
```

`--explain` prints a detailed explanation of the selected action.
