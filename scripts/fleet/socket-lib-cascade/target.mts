/**
 * @file The socket-lib cascade's TARGET resolution: which already-published
 *   socket-lib version a run drives, and the state file that carries that
 *   target forward. Both decisions are lifted out of the CLI shell so the
 *   fresh-cascade, target-drift, and baseline-capture paths are unit-tested
 *   against a tmpdir and a stub registry reader instead of the network. Backs
 *   `../socket-lib-cascade.mts`.
 */

import { LIB_PKG } from './stages.mts'
import {
  loadState,
  newState,
  saveState,
  withBaselineVersions,
  withTargetLibVersion,
} from './state.mts'

import type { CascadeState } from './state.mts'

/**
 * One registry read, injected so target resolution runs without a network. The
 * production implementation is `readLatest` in `./drive.mts`, which wraps
 * fetchLatestPublishedVersionChecked.
 */
export type RegistryReader = (
  pkg: string,
) => Promise<{ latest: string | undefined; reachable: boolean }>

/**
 * The result of deciding which published socket-lib version cascades. The
 * `resolved` arm carries the version and where it came from; every other arm is
 * fatal for the caller and carries the operator-facing message to print.
 */
export type TargetVersion =
  | {
      source: 'pinned' | 'registry'
      status: 'resolved'
      version: string
    }
  | {
      message: string
      status: 'empty-pin' | 'unpublished' | 'unreachable'
    }

/**
 * Resolve the target socket-lib version: the pinned one when `--version` names
 * it, else the registry latest. This orchestrator only ever reads an ALREADY
 * PUBLISHED version — it never releases socket-lib.
 *
 * An empty `--version` value is rejected rather than accepted. The CLI parser
 * hands a valueless `--version` through as `''`, and an empty target would name
 * `@socketsecurity/lib@` in the catalog bump and stamp an empty
 * `targetLibVersion` into the state file — a garbage cascade wearing a
 * success shape.
 */
export async function resolveTargetVersion(config: {
  namedVersion: string | undefined
  readLatest: RegistryReader
}): Promise<TargetVersion> {
  const cfg = { __proto__: null, ...config } as typeof config
  const { namedVersion } = cfg
  if (namedVersion !== undefined) {
    const pinned = namedVersion.trim()
    if (pinned === '') {
      return {
        message:
          `--version needs a published ${LIB_PKG} version. Where: the cascade CLI. ` +
          `Saw: an empty value. Fix: pass \`--version X.Y.Z\`, or drop the flag ` +
          `to cascade the registry latest.`,
        status: 'empty-pin',
      }
    }
    return { source: 'pinned', status: 'resolved', version: pinned }
  }
  const read = await cfg.readLatest(LIB_PKG)
  if (!read.reachable) {
    return {
      message: `Could not read ${LIB_PKG} latest from the registry — re-run when it is reachable, or pin --version.`,
      status: 'unreachable',
    }
  }
  if (read.latest === undefined) {
    return {
      message: `${LIB_PKG} has no published version — nothing to cascade.`,
      status: 'unpublished',
    }
  }
  return { source: 'registry', status: 'resolved', version: read.latest }
}

/**
 * Whether socket-lib's own manifest sits AHEAD of the version being cascaded —
 * an unreleased bump.
 *
 * The orchestrator deliberately targets an already-published version, because
 * `pnpm run update` can only pull what npm serves. That is correct, and it is
 * also how a whole train can propagate a STALE version: someone bumps the
 * manifest and writes the changelog, the release never goes out, and every
 * downstream repo then absorbs the older release while the newer one sits
 * unpublished. Same failure the bump base guards against upstream — a manifest
 * ahead of the registry is a release that did not happen.
 *
 * Advisory, never fatal: cascading the published version is still the right
 * move when the newer one is not out yet. The run says so instead of looking
 * like it covered work it never touched.
 */
export function manifestAheadWarning(config: {
  manifestVersion: string | undefined
  targetVersion: string
}): string | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  const manifest = cfg.manifestVersion?.trim()
  if (!manifest || manifest === cfg.targetVersion) {
    return undefined
  }
  return (
    `${LIB_PKG} manifest is ${manifest}, but this cascade targets ` +
    `${cfg.targetVersion}.\n` +
    `  What:   the checkout carries a version the registry has not published.\n` +
    `  Where:  socket-lib package.json vs the npm latest this run resolved.\n` +
    `  Saw:    manifest ${manifest}, cascading ${cfg.targetVersion}. Every ` +
    `downstream stage will absorb ${cfg.targetVersion}.\n` +
    `  Fix:    release ${manifest} first, then re-run to cascade it — or ` +
    `continue if propagating ${cfg.targetVersion} is intended.`
  )
}

/**
 * What `ensureCascadeState` did, so the caller can report it without redoing
 * the reasoning.
 */
export interface CascadeStateSetup {
  /**
   * True when a fresh state was written — no usable state existed, or a drift
   * reset discarded the old one.
   */
  created: boolean
  /**
   * The target the discarded state was driving, or undefined when nothing
   * drifted. Present only alongside `created`.
   */
  driftedFrom: string | undefined
  state: CascadeState
  /**
   * True when an existing state had no target yet and this run stamped one in,
   * keeping its receipts.
   */
  targetBackfilled: boolean
}

/**
 * Load the cascade state for `target`, creating or resetting it as needed, and
 * persist the result to `file`.
 *
 * Three paths: an existing state already driving `target` resumes untouched; an
 * existing state driving a DIFFERENT target is discarded, because its receipts
 * describe a cascade of the old version; no usable state means a fresh one,
 * whose advance-gate baselines are the registry latest of each produced package
 * captured once, before the cascade moves any of them.
 */
export async function ensureCascadeState(config: {
  file: string
  now: string
  producedPkgs: readonly string[]
  readLatest: RegistryReader
  target: string
}): Promise<CascadeStateSetup> {
  const cfg = { __proto__: null, ...config } as typeof config
  const { file, target } = cfg
  let state = loadState(file)
  let driftedFrom: string | undefined
  if (
    state &&
    state.targetLibVersion !== undefined &&
    state.targetLibVersion !== target
  ) {
    driftedFrom = state.targetLibVersion
    state = undefined
  }
  if (!state) {
    const baselines: Record<string, string> = {}
    for (const pkg of cfg.producedPkgs) {
      const read = await cfg.readLatest(pkg)
      // A package with nothing published has no baseline to beat, so it is
      // left out instead of recorded as an empty version the advance gate
      // would then compare against.
      if (read.latest !== undefined) {
        baselines[pkg] = read.latest
      }
    }
    const fresh = withBaselineVersions(
      withTargetLibVersion(newState(cfg.now), target),
      baselines,
    )
    saveState(file, fresh)
    return { created: true, driftedFrom, state: fresh, targetBackfilled: false }
  }
  if (state.targetLibVersion === undefined) {
    const stamped = withTargetLibVersion(state, target)
    saveState(file, stamped)
    return {
      created: false,
      driftedFrom,
      state: stamped,
      targetBackfilled: true,
    }
  }
  return { created: false, driftedFrom, state, targetBackfilled: false }
}
