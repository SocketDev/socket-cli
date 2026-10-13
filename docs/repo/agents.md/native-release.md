# Native release

The npm release pipeline owns the release version, changelog, source commit, and reserved tag. Start it through `pnpm run publish:npm --dist-tag next` for the prerelease channel. Do not edit `package.json` to reserve a release. The native workflow consumes the reserved source SHA and package version.

## Local checks

Build the production native matrix and inspect the resulting package:

```sh
pnpm run build:native:prod
pnpm run check:native-package
```

Focused release tests:

```sh
pnpm test test/repo/unit/build/sea/release.test.mts
pnpm test test/repo/unit/check/publish-contract-is-valid.test.mts
pnpm test test/repo/unit/sea/check.test.mts
```

## CI qualification

The `publish: native` workflow builds and signs the package on macOS. The Apple certificate passphrase is supplied only as a CI secret. The workflow uploads one package archive, verifier, and receipt. Qualification jobs check the archive and digests, then run that verifier for all eight targets:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-arm64-musl`
- `linux-x64`
- `linux-x64-musl`
- `win32-arm64`
- `win32-x64`

The macOS jobs also run Gatekeeper qualification. Treat the artifact as qualified only when the workflow reports success for every target.

## Stage

Inspect the staged package with `pnpm run npm:staged`. After validation and a clean scan, approve eligible stages with `pnpm stage approve`. The AI Drive/browser path is a fallback when the CLI cannot complete authentication or npm presents a challenge; it is not a separate approval prerequisite.
