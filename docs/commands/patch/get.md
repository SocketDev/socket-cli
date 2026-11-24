# `socket patch get`

Get a security patch by UUID, CVE, GHSA, PURL, or package name. The command
uses the project's existing patch mode, or hosted mode if none is configured.
Hosted mode can rewrite dependency files to use Socket's patched packages.

```sh
socket patch get <uuid> --org <slug> --save-only
```

Use `--save-only` to select agent mode and record the downloaded patch in
`.socket/manifest.json` without applying it. Run `socket patch apply` to apply
recorded patches to installed files. Use `--mode` to choose hosted, vendored,
or agent behavior explicitly.
Run `socket patch get --help` for identifier and confirmation options.
