/**
 * @file The socket-lib cascade's stage TABLE: the four fleet packages the
 *   cascade turns on, the strict stage order, each stage's spec (pre-gate,
 *   repo, published package, user-gated flag), and the pure lookups over that
 *   table. This is the driver layer only — the downstream obligation
 *   relationships live in RELEASE_CASCADE_GRAPH and are consumed from there,
 *   never duplicated here. Backs `../socket-lib-cascade.mts`.
 */

import path from 'node:path'

import { flattenObligations } from '../lib/release-cascade.mts'

/**
 * The four fleet packages the cascade turns on — the socket-lib trigger and
 * the three downstream packages whose releases chain off it.
 */
export const LIB_PKG = '@socketsecurity/lib'
export const PURL_PKG = '@socketregistry/packageurl-js'
export const REGISTRY_PKG = '@socketsecurity/registry'
export const SDK_PKG = '@socketsecurity/sdk'

export type CascadeStageId =
  | 'wheelhouse-catalog'
  | 'packageurl-js'
  | 'socket-registry'
  | 'socket-sdk-js'
  | 'socket-cli'

/**
 * The cascade stages in strict execution order. A downstream stage never runs
 * before the stage above it has landed its published version.
 */
export const CASCADE_STAGE_ORDER: readonly CascadeStageId[] = [
  'wheelhouse-catalog',
  'packageurl-js',
  'socket-registry',
  'socket-sdk-js',
  'socket-cli',
]

/**
 * How a stage's pre-gate is measured. `fixed` — a named version must be live,
 * used for the entry gate on the target @socketsecurity/lib version. `advance`
 * — the package's registry latest must have moved past the baseline captured
 * at cascade start, the signal that the prior stage's release actually
 * published.
 */
export type GateMode = 'advance' | 'fixed'

export interface StageGate {
  mode: GateMode
  pkg: string
}

export interface CascadeStageSpec {
  /**
   * The pre-gate this stage waits on before it may pull the upstream via
   * `pnpm run update`.
   */
  gate: StageGate
  /**
   * One-line purpose for the status table and banners.
   */
  description: string
  /**
   * The npm package this stage's release publishes, whose advance past the
   * baseline gates the NEXT stage. undefined for the catalog bump and the
   * push-only cli stage — neither publishes a package.
   */
  publishes: string | undefined
  /**
   * The sibling repo directory name under $PROJECTS, or undefined when the
   * stage runs in the wheelhouse itself.
   */
  repo: string | undefined
  /**
   * True when the stage defers to a repo's own release-pipeline, which stops at
   * the USER version gate and the web-UI staged approve. The orchestrator never
   * names a version or approves a package; it sequences and gates.
   */
  userGated: boolean
}

/**
 * The release TRAIN: the strict per-stage order, which repo each stage drives,
 * and which package its release publishes. This is the driver layer only — the
 * downstream obligation relationships live in RELEASE_CASCADE_GRAPH and are
 * consumed from there, never duplicated here.
 */
export const CASCADE_STAGES: Readonly<
  Record<CascadeStageId, CascadeStageSpec>
> = {
  'packageurl-js': {
    gate: { mode: 'fixed', pkg: LIB_PKG },
    description:
      'pnpm run update then release @socketregistry/packageurl-js via its release-pipeline — USER names the version, USER approves the staged package',
    publishes: PURL_PKG,
    repo: 'socket-packageurl-js',
    userGated: true,
  },
  'socket-cli': {
    gate: { mode: 'advance', pkg: SDK_PKG },
    description:
      'pnpm run update on the v1.x and main branches to pull the new @socketsecurity/sdk, then push each branch — no release',
    publishes: undefined,
    repo: 'socket-cli',
    userGated: false,
  },
  'socket-registry': {
    gate: { mode: 'advance', pkg: PURL_PKG },
    description:
      'update socket-lib + packageurl-js, refresh registry/manifest.json, release @socketsecurity/registry via its release-pipeline — USER version + staged approve',
    publishes: REGISTRY_PKG,
    repo: 'socket-registry',
    userGated: true,
  },
  'socket-sdk-js': {
    gate: { mode: 'advance', pkg: REGISTRY_PKG },
    description:
      'update socket-lib + packageurl-js, release @socketsecurity/sdk via its release-pipeline — USER version + staged approve',
    publishes: SDK_PKG,
    repo: 'socket-sdk-js',
    userGated: true,
  },
  'wheelhouse-catalog': {
    gate: { mode: 'fixed', pkg: LIB_PKG },
    description:
      'bump the @socketsecurity/lib catalog pin to the target, reconcile the -stable alias, dogfood, install --lockfile-only, assert catalog checks, land to wheelhouse main',
    publishes: undefined,
    repo: undefined,
    userGated: false,
  },
}

/**
 * The branches the push-only socket-cli stage refreshes and pushes, in order.
 */
export const SOCKET_CLI_BRANCHES: readonly string[] = ['v1.x', 'main']

/**
 * The npm packages the cascade publishes, in stage order — the set whose
 * registry latest is snapshotted as the advance-gate baseline.
 */
export function producedPackages(): string[] {
  const out: string[] = []
  for (let i = 0, { length } = CASCADE_STAGE_ORDER; i < length; i += 1) {
    const { publishes } = CASCADE_STAGES[CASCADE_STAGE_ORDER[i]!]
    if (publishes !== undefined) {
      out.push(publishes)
    }
  }
  return out
}

/**
 * The sibling repo directory for a repo name under a projects root. Pure.
 */
export function siblingRepoDir(projectsDir: string, repo: string): string {
  return path.join(projectsDir, repo)
}

/**
 * Whether the RELEASE_CASCADE_GRAPH declares that `repo` carries a
 * registry-manifest-entry obligation for `pkg` — the socket-registry
 * registry/manifest.json purl entry a stage must refresh when it absorbs the
 * upstream. Sourced from the graph via flattenObligations, never re-listed
 * here, so the driver reads the single dependency graph rather than duplicating
 * it. Pure.
 */
export function repoNeedsManifestRefresh(config: {
  pkg: string
  repo: string
}): boolean {
  const cfg = { __proto__: null, ...config } as typeof config
  const edges = flattenObligations(cfg.pkg)
  for (let i = 0, { length } = edges; i < length; i += 1) {
    const edge = edges[i]!
    if (edge.kind === 'registry-manifest-entry' && edge.repo === cfg.repo) {
      return true
    }
  }
  return false
}
