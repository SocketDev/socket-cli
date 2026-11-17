# `socket patch repair`

Download missing patch blobs into the local cache and remove unused blobs
from that cache. Repair only changes the patch cache.

```sh
socket patch repair
```

Use `--dry-run` to preview changes, `--download-only` to skip cleanup, or
`--offline` to clean up without network access.
Run `socket patch repair --help` for all options.
