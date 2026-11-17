# Organization dependencies

`socket organization dependencies` lists dependencies recorded for your
organization. You can also use `socket org deps` or `socket deps`.

`--limit` sets the maximum number of dependencies returned and defaults to
50. Use `--offset` to skip dependencies.

```sh
socket org deps
socket org deps --limit 20 --offset 10 --json
```

With `--json`, dependency rows are in `data.rows`. A `data.end` value of
`true` indicates there are no more results.

Use `--purls` to filter by package URL (PURL). Separate PURLs with commas or
repeat the flag to search for multiple packages. The `pkg:` prefix is optional.

```sh
socket org deps --purls 'npm/minimist@0.0.4,pkg:pypi/requests'
```

Include a version to match that version or omit it to match all indexed
versions. Partial matches, wildcards, version ranges, qualifiers, and
subpaths are unsupported.
