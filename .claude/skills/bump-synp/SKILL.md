---
name: bump-synp
description: Update the pinned synp package staged into the native CLI VFS. Use when changing synp.
user-invocable: true
---

# Bump synp

Take the exact released version as `$ARGUMENTS`; ask if missing. Read
[the VFS and notice reference](references/vfs-notices.md), update the exact dev
dependency and lockfile with `pnpm add -D --save-exact "synp@$ARGUMENTS"`, then
run `pnpm build:sea` to rebuild the SEA for the local OS and architecture.
Run this check on macOS arm64 to include the synp payload.

Keep the Yarn Classic capability unavailable while source provenance or notice
obligations remain unresolved. Run the SEA builder and runtime tests, then
inspect the manifest and confirm the capability remains unavailable:

```sh
pnpm run test:unit \
  test/unit/sea/build-sea.test.mts test/unit/sea/runtime.test.mts
pnpm build:sea
```

Create one signed conventional commit and a PR against `v1.x`.
