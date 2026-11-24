# `socket patch scan`

Find and apply available Socket security patches in the current project. By
default, scan uses hosted mode and rewrites lockfiles to resolve patched
packages through Socket's patch service. Use `--dry-run` to preview changes
without writing files:

```sh
socket patch scan --dry-run
```

Apply the hosted lockfile changes with:

```sh
socket patch scan
```

Use `--cwd` to choose a project directory, `--global` to scan globally
installed npm packages, or `--ecosystems` to restrict the scan. Use `--json`
for machine-readable output. Other modes include `vendored`, which stores patch
artifacts in `.socket/vendor/`, and `agent`, which records patches in
`.socket/manifest.json` for `socket patch apply` to apply to installed files.
Run `socket patch scan --help` for all options.
