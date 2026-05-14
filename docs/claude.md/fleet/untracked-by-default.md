# Untracked-by-default for vendored / build-copied trees

Referenced from CLAUDE.md → _Untracked-by-default for vendored / build-copied trees_.

When an untracked directory appears under a path that looks like vendored upstream source — `additions/source-patched/`, `vendor/`, `third_party/`, `external/`, `upstream/`, `deps/<libname>/`, `pkg-node/`, anything with `-bundled`/`-vendored` in the name — assume **untracked-by-default**.

## Three commands before staging

1. **`git status --ignored`** — default `git status` hides ignore matches; only this reveals them. If the path shows under _Ignored files_, stop.
2. **`cat .gitignore` + the package-local `.gitignore`** — read both. Look for directory excludes (`deps/foo/`) AND `!file.ext` allowlist re-includes inside ignored dirs. The allowlists are the only files in those trees that belong to us.
3. **`grep -rln "<dirname>" scripts/ packages/*/scripts/`** — find who creates the directory. If a build script copies it in (e.g. `prepare-external-sources.mts`), the contents are build output, not tracked input. The directory name being something like `source-patched` is itself a tell.

## The `*` + `!file` allowlist pattern

When `.gitignore` has the shape:

```
deps/<libname>/*
!deps/<libname>/<file>
```

…the single allowlisted file is **our custom hand-written glue** that the build script must not clobber.

**Worked example** — `packages/node-smol-builder/additions/source-patched/deps/libdeflate/`:

```
packages/node-smol-builder/additions/source-patched/deps/libdeflate/*
!packages/node-smol-builder/additions/source-patched/deps/libdeflate/libdeflate.gyp
```

Upstream `libdeflate` ships only `CMakeLists.txt`; the Node build pipeline needs `gyp`; we hand-wrote `libdeflate.gyp` and tracked it so the build-time copy-in of upstream source doesn't overwrite it. The allowlist within an ignored dir is a signal that the dir is repeatedly overwritten by a build step, and the allowlisted file is the surface we maintain.

## Language hygiene

Never use language like "must be" / "definitely is" / "presumably" / "looks like" when handling someone else's tree. Those words are the signature of guessing. When you find yourself reaching for them, stop and run the command that turns the guess into a fact.

## Volume gate

For 100+ file or multi-MB untracked drops, ask the user before committing even under a blanket "commit everything" directive. That shape of drop is rarely the intended unit of work.

## Why this rule exists

A misread of an `additions/source-patched/deps/` directory led to a 13MB / 406-file commit of upstream LiteSpeed QUIC source (ls-qpack + lsquic) that was meant to be gitignored and re-copied at build time. The missed clue: a tracked sibling (libdeflate) had only ONE file actually tracked (the custom `.gyp`), not the whole tree. The single-file allowlist is the architecture, not a wholesale tracked-vendoring pattern.
