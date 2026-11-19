# Coana pin and snapshot paths

- The pinned version is `COANA_CLI_VERSION` in `src/constants.mts`.
- The native CLI snapshots that print this version are listed under `coana` in
  `scripts/refresh/snapshots/dependencies.mts`. The checked-in files are the fix,
  scan-create, and scan-reach help snapshots.
- Use `node scripts/refresh/snapshots/swap-version.mts --dep coana --from <old>` to
  preserve the terminal row width without a native build. If it refuses the
  change, regenerate with `pnpm snapshots:update:dep coana` on a built native
  CLI.
- Coana runs from its Socket API download. SEA does not bundle it.
