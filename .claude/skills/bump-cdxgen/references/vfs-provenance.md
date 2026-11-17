# cdxgen VFS and provenance

- The pin is the `@cyclonedx/cdxgen` dev dependency in `package.json`; pnpm
  records its graph in `pnpm-lock.yaml`.
- `src/sea/build-sea.mts` bundles it through the Rollup config
  `.config/rollup.cdxgen-sea.config.mjs` for darwin-arm64.
- Exact-version license and source provenance entries live in
  `.config/rollup.cdxgen-sea.config.mjs` and `src/sea/rollup-provenance.mjs`.
- `src/sea/README.md` records that cdxgen remains unavailable until source
  provenance and notice obligations are resolved. A package bump alone does
  not qualify it for use.
- Validate with `test/unit/sea/build-sea.test.mts`,
  `test/unit/sea/runtime.test.mts`, and a darwin-arm64 prototype build.
