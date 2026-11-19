# Socket CLI release lanes

The workflow is `.github/workflows/publish-npm.yml`. It prepares a version PR
first; publishing is a separate dispatch after that PR is merged.

| Lane | Release line | npm packages | npm dist-tag |
| --- | --- | --- | --- |
| Stable | v1.x | `socket`, `@socketsecurity/cli`, `@socketsecurity/cli-with-sentry` | `latest` |
| Native prerelease | 2.1.0 RCs | `socket` only | `rc-2.1.0` |

The package list is enforced by `scripts/release/packages.mts`. The build
matrix is defined in `scripts/build-package-matrix.mts`. Prerelease versions
come from `.config/release.json`; keep the `rc` identifier and configured
dist-tag. Never publish an RC as `latest` or promote this track to stable.

`release-major=1` selects the stable v1 line. `release-major=2` selects the
configured prerelease-only line. The `release-pr` workflow derives the next
patch or minor version from commits unless `release-as` is required for a
breaking release. A dry run prints the proposed version and changelog without
opening a PR. Set `dry-run=false` only when the user asks to create the release
preparation PR.

After the merged version PR, the separate `mode=publish` workflow builds and
tests package tarballs. Stable releases stage all three packages; RC releases
stage only `socket`. A human approves each npm stage ID locally. Approval and
GitHub release creation are not part of the bump skill.
