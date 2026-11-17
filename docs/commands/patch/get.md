# `socket patch get`

Download a security patch by UUID, CVE, GHSA, PURL, or package name. By
default, the command downloads and applies the selected patch:

```sh
socket patch get <uuid> --org <slug>
```

Use `--save-only` to download without applying. Use `--one-off` to apply a
patch immediately without saving it in `.socket/`.
Run `socket patch get --help` for identifier and confirmation options.
