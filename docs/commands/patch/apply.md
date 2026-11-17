# `socket patch apply`

Apply patches recorded in the project manifest. The default manifest is
`.socket/manifest.json`:

```sh
socket patch apply
```

Use `--dry-run` to verify that patches can be applied without changing files.
Run `socket patch apply --help` for offline, global-package, and output
options.
