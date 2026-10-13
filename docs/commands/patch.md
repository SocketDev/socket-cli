# Patch records

## `socket patch`

Most patch operations pass to the bundled `socket-patch` tool. For example:

```sh
socket patch apply
```

`socket patch list` reads the local patch manifest:

```sh
socket patch list --json
```

`socket patch remove <PURL-or-UUID> --skip-rollback` removes a record from that
manifest without reverting patched files:

```sh
socket patch remove pkg:npm/example@1.0.0 --skip-rollback
```

The local list and remove forms work directly in the CLI. Other operations,
including a remove without `--skip-rollback`, go to `socket-patch`.
