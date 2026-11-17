---
name: bump-cdxgen
description: Update the pinned cdxgen package staged into the native CLI VFS. Use when changing @cyclonedx/cdxgen.
user-invocable: true
---

# Bump cdxgen

Take the exact released version as `$ARGUMENTS`; ask if missing. Read
[the VFS and provenance reference](references/vfs-provenance.md), update the
exact dev dependency and lockfile with
`pnpm add -D --save-exact "@cyclonedx/cdxgen@$ARGUMENTS"`, then rebuild the
macOS arm64 SEA prototype with `pnpm build:sea -- --prototype`.

Check the new dependency graph and update package-version-specific provenance,
license text, and notices where required. Keep the cdxgen capability unavailable
while any source or notice obligation remains unresolved. Run the SEA builder
and runtime tests, then inspect the manifest and confirm the capability remains
unavailable:

```sh
pnpm run test:unit \
  test/unit/sea/build-sea.test.mts test/unit/sea/runtime.test.mts
pnpm build:sea -- --prototype
```

Create one signed conventional commit and a PR against `v1.x`.
