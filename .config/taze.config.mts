import { defineConfig } from 'taze'

/* Socket-owned scopes bypass the 7-day maturity cooldown.
 *
 * The cooldown (maturityPeriod: 7) exists to catch compromised
 * upstream packages before we adopt them — but Socket-published
 * packages go through our own provenance + publish pipeline, so
 * we trust them to ship fresh.
 *
 * The scopes listed here are EXCLUDED from pass 1 (the
 * cooldown-respecting pass) and INCLUDED in pass 2 (the
 * immediate-bump pass). Keep this list in sync with
 * scripts/update.mts if the repo ships one, or with whatever
 * second-pass mechanism the consuming repo's update script
 * uses.
 */
const SOCKET_SCOPES = [
  '@socketregistry/*',
  '@socketsecurity/*',
  '@socketdev/*',
  'socket-*',
  'ecc-agentshield',
  'sfw',
]

export default defineConfig({
  // Interactive mode disabled for automation.
  interactive: false,
  // Minimal logging.
  loglevel: 'warn',
  // Socket scopes handled by a second pass with maturityPeriod 0.
  exclude: SOCKET_SCOPES,
  // 7-day cooldown on third-party deps — matches `.npmrc`'s
  // min-release-age setting for install-time enforcement.
  maturityPeriod: 7,
  // Bump to latest across major boundaries.
  mode: 'latest',
  // Edit package.json in place.
  write: true,
})
