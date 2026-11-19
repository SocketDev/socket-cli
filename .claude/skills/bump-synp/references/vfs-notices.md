# synp VFS and notices

- The pin is the `synp` dev dependency in `package.json`; pnpm records its graph
  in `pnpm-lock.yaml`.
- `src/sea/stage/synp.mts` stages it under `tools/synp`; the VFS manifest is
  written in `src/sea/build-sea.mts`.
- `src/sea/README.md` says the Yarn Classic capability remains unavailable
  while source provenance and third-party notice obligations are unresolved.
  A version bump must not enable the capability by itself.
- Validate with `test/unit/sea/build-sea.test.mts`,
  `test/unit/sea/runtime.test.mts`, and a darwin-arm64 prototype build.
