---
name: bump-uv
description: Update the pinned uv binary embedded in the native CLI VFS. Use when changing src/sea/stage/uv-pins.json.
user-invocable: true
---

# Bump embedded uv

Take the exact upstream release version as `$ARGUMENTS`; ask if missing. Read
[the uv pin reference](references/pin-and-verification.md), then update
`src/sea/stage/uv-pins.json` from the official uv release and source tag.

Refresh the release URL, archive name, and SHA-256 for every declared target.
Refresh the license-file hashes only from the matching upstream tag. Do not
guess a digest or reuse one from another target.

Run the SEA builder and runtime tests, then build on each available native CI
target:

```sh
pnpm run test:unit \
  test/unit/sea/build-sea.test.mts test/unit/sea/runtime.test.mts
pnpm build:sea -- --prototype
```

Confirm the adjacent `build/sea/*.manifest.json` reports the new uv version
and the installed binary's digest matches the manifest. Add a changelog entry
only when the change affects user-visible behavior. Create one signed
conventional commit and a PR against `v1.x`.
