# reserved-script-dir-guard

PreToolUse(Edit/Write/MultiEdit) hook that blocks creating a file under a
`scripts/<reserved>/` directory whose name collides with a build / output /
tooling concept.

## What it catches

An Edit/Write whose `file_path` is under one of these `scripts/` dirs:

- `scripts/build/` — collides with the `build` package.json script + the
  `dist/` output + `scripts/build-externals/`
- `scripts/dist/` — `dist/` is the output dir, not a script dir
- `scripts/node_modules/` — install dir
- `scripts/coverage/` — coverage report output
- `scripts/cache/` — tool cache (belongs in `node_modules/.cache/`)

## What it allows

- `scripts/fleet/**` and `scripts/repo/**` — the two canonical tiers
- `scripts/_*/**` — internals folders
- Any feature dir named for what it does: `scripts/bundle/`,
  `scripts/post-build/`, `scripts/build-externals/` (only the bare `build`
  segment is reserved, not `build-*` or `post-build`).

## Why

`scripts/` is two canonical tiers (`fleet`, `repo`) plus feature dirs named for
their job. A dir called `build`/`dist`/etc. overloads a reserved meaning and
reads ambiguously. A rolldown build runner parked at `scripts/build/cli.mts`
collides with the `build` package.json script + the `dist/` output dir; name it
for its job (`scripts/bundle/`) so the segment stops overloading.

## Bypass

Type `Allow reserved-script-dir bypass` in a recent turn.

## Exit codes

- `0` — pass (not Edit/Write, path not under a reserved dir, or bypassed)
- `2` — block
- Fails open on any internal error.
