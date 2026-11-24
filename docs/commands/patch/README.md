# `socket patch`

Manage Socket security patches for dependencies. Patch records are stored in
`.socket/manifest.json` by default.

```sh
socket patch scan
socket patch get <uuid> --org <slug> --save-only
socket patch apply
```

Bare `scan` applies hosted lockfile changes; use `scan --dry-run` to preview.
`apply` is used with agent mode to patch installed files.

See the guides for [scanning](scan.md), [downloading](get.md), [applying](apply.md),
[rolling back](rollback.md), [listing](list.md), [removing](remove.md),
[migrating from setup](setup.md), and [repairing the patch cache](repair.md).
