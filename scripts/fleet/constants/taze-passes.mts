/*
 * @file The exact CLI argument lists for the two taze passes `pnpm run update`
 *   spawns — the single source both `scripts/fleet/update.mts` and the
 *   taze-behavior integration tests consume, so the tested invocation can never
 *   drift from the shipped one.
 *
 *   Every flag is load-bearing:
 *
 *   - `--include-locked` — taze treats an EXACT version as "locked" and skips
 *     it entirely without this flag. Every catalog pin in the fleet is exact —
 *     including every Socket first-party pin — so omitting the flag turned the
 *     whole catalog into a silent no-op: taze printed "already up-to-date"
 *     while newer releases existed. The soak gate is unaffected because taze
 *     filters candidate versions by `maturityPeriod` BEFORE the locked check —
 *     a locked pin only ever sees soak-cleared versions, exactly like a range.
 *   - `--maturity-period` — must ride the CLI: taze's CLI default is 0 and CLI
 *     values override config, so leaving it off silently disables the cooldown.
 *   - `--exclude` — must also ride the CLI. taze discovers config only as a
 *     root-level `taze.config.<ext>` walking UP from cwd — unconfig never looks
 *     inside `.config/fleet/`, so the exclude list in
 *     `.config/fleet/taze.config.mts` never applies at runtime. Moving that
 *     config to the repo root would break pass 2 instead, because a config
 *     `exclude` overrides a CLI `--include`. The flags here are the enforced
 *     policy surface; the config file documents the same policy for humans.
 *
 *   taze auto-detects `maturityPeriodExclude` from the workspace's
 *   `minimumReleaseAgeExclude` patterns, so the pnpm soak excludes and the taze
 *   cooldown excludes stay one list.
 */
import { SOAK_DAYS } from './soak.mts'
import { SOCKET_SCOPES, UPDATE_PINNED_TOOLCHAIN } from './socket-scopes.mts'

/**
 * Per-package registry request timeout, milliseconds. Large full packuments —
 * sharp, typescript — can exceed taze's 5s default cold, and every lookup goes
 * through the direct-registry client from the single-registry patch, which
 * fetches full packuments. Must ride the CLI for the same reason as the flags
 * above: the `requestTimeout` in the config file is never discovered.
 */
const TAZE_REQUEST_TIMEOUT_MS = 30_000

/**
 * Pass 1 — third-party deps: soak-gated by `SOAK_DAYS`, with Socket scopes
 * deferred to pass 2 and the pinned dev toolchain excluded outright — those
 * are bumped deliberately, never on the automatic cadence.
 */
export const TAZE_PASS_THIRD_PARTY_ARGS: readonly string[] = [
  '--maturity-period',
  String(SOAK_DAYS),
  '--include-locked',
  '--exclude',
  [...SOCKET_SCOPES, ...UPDATE_PINNED_TOOLCHAIN].join(','),
  '--request-timeout',
  String(TAZE_REQUEST_TIMEOUT_MS),
  '--write',
]

/**
 * Pass 2 — Socket first-party deps only, no cooldown: Socket-published
 * packages go through our own provenance pipeline, so they ship fresh.
 * `--include` is comma-separated and restricts the pass to these scopes.
 */
export const TAZE_PASS_SOCKET_ARGS: readonly string[] = [
  '--include',
  SOCKET_SCOPES.join(','),
  '--maturity-period',
  '0',
  '--include-locked',
  '--request-timeout',
  String(TAZE_REQUEST_TIMEOUT_MS),
  '--write',
]
