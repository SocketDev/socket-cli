import { defineConfig } from 'taze'

// Socket-owned scopes bypass the 7-day maturity cooldown (the cooldown catches
// compromised upstreams before adoption; Socket-published packages go through
// our own provenance + publish pipeline). EXCLUDED from pass 1 (cooldown) and
// INCLUDED in pass 2 (immediate bump). SOCKET_SCOPES is the single shared
// constant — scripts/fleet/update.mts imports the same one, so they can't drift.
import { SOAK_DAYS } from '../../scripts/fleet/constants/soak.mts'
import {
  SOCKET_SCOPES,
  UPDATE_PINNED_TOOLCHAIN,
} from '../../scripts/fleet/constants/socket-scopes.mts'

// oxlint-disable-next-line socket/no-default-export -- taze loads its config via default export per the documented API.
export default defineConfig({
  // Interactive mode disabled for automation.
  interactive: false,
  // Minimal logging.
  loglevel: 'warn',
  // Socket scopes are excluded here (pass 1) and re-included in pass 2 with
  // maturityPeriod 0. The pinned dev toolchain (oxlint/oxfmt/rolldown/typescript
  // + bindings) is excluded from BOTH passes — bumped deliberately, never on the
  // automatic cadence.
  exclude: [...SOCKET_SCOPES, ...UPDATE_PINNED_TOOLCHAIN],
  // Cooldown on third-party deps, derived from the canonical SOAK_DAYS so it
  // can't drift from `.npmrc` min-release-age / pnpm-workspace minimumReleaseAge.
  maturityPeriod: SOAK_DAYS,
  // Bump to latest across major boundaries.
  mode: 'latest',
  // Per-package registry request timeout. Large full packuments (sharp,
  // typescript) can exceed taze's 5s default cold — and every lookup goes
  // through the direct-registry client (the single-registry patch in
  // patches/taze@*.patch), which fetches full packuments. Config-wired since
  // taze 19.16.0 (this replaced the timeout half of that patch).
  requestTimeout: 30_000,
  // Edit package.json in place.
  write: true,
})
