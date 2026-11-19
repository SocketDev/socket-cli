# Node SEA pin and qualification

- `src/sea/.node-version` is the source pin. `src/sea/node-version.mts` reads
  it, and the README version markers are updated from that value during the SEA
  build.
- `src/sea/build-sea.mts` downloads the official Node archive and verifies it
  against that release's `SHASUMS256.txt` before building.
- The builder relies on the Node SEA VFS API. Check the release notes and build
  on the intended OS/architecture before describing it as qualified.
- Read [the SEA build notes](../../../../src/sea/README.md) for target support
  and experimental status.
