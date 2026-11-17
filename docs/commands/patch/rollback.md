# `socket patch rollback`

Restore files changed by patches:

```sh
socket patch rollback
socket patch rollback <purl-or-uuid>
```

Without an identifier, the command rolls back all patches in the manifest. Use
`--dry-run` to verify the rollback without changing files. Run
`socket patch rollback --help` for one-off and global-package options.
