/**
 * @file Deliberate catalog holds — the fleet's declaration that a package must
 *   NOT advance past a named version, and why.
 *   A hold exists because "newer" and "correct" are not the same thing. An
 *   upstream can publish a release that is broken, accidental, or later
 *   deprecated, and the version number still sorts highest. Without a hold,
 *   every automation that advances a pin re-adopts that release on its next
 *   run, and a human is left re-applying the same fix forever.
 *   This file is the machine-readable half of a hold. The YAML comment above
 *   the pin in `.config/fleet/pnpm-workspace.fleet.yaml` stays as the prose a
 *   reader needs, but a comment is invisible to the fixer that rewrites the
 *   line beneath it — the entry HERE is what actually stops the rewrite.
 *   Releasing a hold is always a deliberate human edit: delete the entry once
 *   `releaseWhen` is satisfied. No script may infer that a hold has expired,
 *   because the condition is a judgment (does the fix actually work here?),
 *   not a version comparison.
 */

/**
 * One held package: the version the fleet stays on, why it stopped there, and
 * the condition under which a human may lift the hold.
 */
export interface CatalogHold {
  /**
   * The exact version the fleet holds at. Nothing above it may be adopted.
   */
  readonly heldAt: string
  /**
   * Why the newer release is not acceptable, in one operator-readable line.
   */
  readonly reason: string
  /**
   * What must become true before a human deletes this entry.
   */
  readonly releaseWhen: string
}

/**
 * Every deliberate hold, keyed by package name. Consulted by the catalog
 * lockstep (`scripts/fleet/update/fleet-pins.mts`) before it mirrors any pin
 * upward, and verified by `check/catalog-pins-are-not-deprecated.mts`.
 */
export const FLEET_CATALOG_HOLDS: Readonly<Record<string, CatalogHold>> = {
  nock: {
    heldAt: '14.0.16',
    reason:
      'nock 15.0.0 was published accidentally and is deprecated upstream ("released accidentally and is unstable. Please use v14.x"). It ships @mswjs/interceptors 0.39.8, whose fetch bypass path clones an already-consumed request and throws TypeError: unusable on any fetch POST-with-body to an enableNetConnect-allowed host, which reds the Test jobs. 14.0.16 is the same interceptors-based API family and passes the regression repro.',
    releaseWhen:
      'a stabilized 15.x ships (not a 15.0.0-beta) AND it passes the fetch POST-with-body repro that 15.0.0 fails',
  },
}

/**
 * The hold for `name`, or `undefined` when the package is not held. Pure.
 */
export function getCatalogHold(name: string): CatalogHold | undefined {
  return FLEET_CATALOG_HOLDS[name]
}
