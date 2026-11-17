# Socket Patch pin and SEA notes

- The source pin is `dependencies.@socketsecurity/socket-patch` in
  `package.json`; pnpm records the resolved package and platform variants in
  `pnpm-lock.yaml`.
- `scripts/test/snapshot-dependencies.mts` lists the native help snapshots and
  the version snapshot. The version snapshot is the one that changes with a
  package version bump.
- `src/sea/build-sea.mts` reads the exact package version, verifies installed
  metadata and lockfile integrity, and stages the target executable plus its
  license into the SEA VFS.
- Read [the SEA build notes](../../../../src/sea/README.md) before changing
  bundled-tool or notice behavior. Verify platform packages and license files
  against their upstream sources.
