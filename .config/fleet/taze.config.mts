import { defineConfig } from 'taze'

// Socket-owned scopes bypass the 7-day maturity cooldown (the cooldown catches
// compromised upstreams before adoption; Socket-published packages go through
// our own provenance + publish pipeline). EXCLUDED from pass 1 (cooldown) and
// INCLUDED in pass 2 (immediate bump). SOCKET_SCOPES is the single shared
// constant — scripts/fleet/update.mts imports the same one, so they can't drift.
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
  // 7-day cooldown on third-party deps — matches `.npmrc`'s
  // min-release-age setting for install-time enforcement.
  maturityPeriod: 7,
  // Bump to latest across major boundaries.
  mode: 'latest',
  // Edit package.json in place.
  write: true,
})
