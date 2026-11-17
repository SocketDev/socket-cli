---
name: bump-socket-patch
description: Bump the pinned Socket Patch package and refresh its native CLI version snapshot. Use when updating @socketsecurity/socket-patch.
user-invocable: true
---

# Bump Socket Patch

Take the exact released version as `$ARGUMENTS`. Ask for it if missing. Read
[the pin and SEA notes](references/pin-and-sea.md), then:

1. Read the current exact `@socketsecurity/socket-patch` pin from
   `package.json`.
2. Update it with `pnpm add --save-exact "@socketsecurity/socket-patch@$ARGUMENTS"`.
3. Refresh the native version screenshot without rebuilding:

   ```sh
   node scripts/test/swap-snapshot-version.mts --dep socket-patch --from <old-version>
   ```

   If the helper reports no matching version or insufficient row space, use
   `pnpm snapshots:update:dep socket-patch` with a native build.
4. Add or replace the Unreleased entry:

   ```sh
   node scripts/release/add-unreleased.mts \
     --replace '^Updated @socketsecurity/socket-patch to v' \
     "Updated @socketsecurity/socket-patch to v $ARGUMENTS."
   ```

   Never write a release heading or change the top-level CLI version.
5. Run the snapshot dependency unit test and build a prototype:

   ```sh
   pnpm run test:unit:snapshot-dependencies
   pnpm build:sea -- --prototype
   ```

   Inspect the generated `build/sea/*.manifest.json` to confirm the target
   records the new patch version and its executable/license payloads.
6. Create one signed conventional commit and a PR against `v1.x` titled
   `build(deps): update Socket Patch to v<version>`.

Keep the change scoped to the package pin, lockfile, affected snapshots,
changelog entry, and any verified redistribution metadata needed by that
release.
