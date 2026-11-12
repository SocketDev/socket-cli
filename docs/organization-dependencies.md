# Organization dependency inventory

`socket organization dependencies` lists dependency records known to your
organization. It does not scan the current directory.

Each request returns one page. `--limit` defaults to 50 and `--offset` to 0.
Increase the offset by the limit until `Is there more data after this?` says
`no`:

```sh
socket organization dependencies
socket organization dependencies --limit 20
socket organization dependencies --limit 20 --offset 20
```

## Filter by package

Pass a full package URL (PURL) to `--purls`. Repeat the flag to filter multiple
packages:

```sh
socket organization dependencies \
  --purls 'pkg:npm/minimist@0.0.4' \
  --purls 'pkg:pypi/requests'
```

A versioned PURL matches that version. Without a version, it matches all indexed
versions. Filters do not support substrings, wildcards, ranges, qualifiers, or
subpaths.

Use `--json` for JSON output. Dependency records are in `data.rows`:

```sh
socket organization dependencies --json > dependencies.json
```
