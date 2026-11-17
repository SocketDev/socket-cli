# `socket patch remove`

Remove a patch by PURL or patch UUID. The command rolls back the patch's file
changes before removing its manifest entry:

```sh
socket patch remove <purl-or-uuid>
```

Use `--skip-rollback` to remove only the manifest entry and leave the
installed files as they are. Run `socket patch remove --help` for confirmation
and global-package options.
