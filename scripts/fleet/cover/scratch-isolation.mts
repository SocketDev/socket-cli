/**
 * @file Per-run coverage-scratch isolation. Imported FIRST by cover.mts —
 *   before paths.mts derives COVERAGE_SCRATCH_DIR — so it can pin a UNIQUE
 *   scratch dir for THIS cover run into the environment. cover threads one
 *   FLEET_COVERAGE_SCRATCH_DIR through the whole process tree (the parent, the
 *   heap-headroom re-exec, and every spawned vitest tier + the node children
 *   the tests spawn all inherit the env), so a fresh, process-unique value
 *   means two concurrent cover runs — different worktrees, parallel agents, a
 *   member repo next to the wheelhouse — can never touch each other's scratch.
 *   WHY: COVERAGE_SCRATCH_DIR used to be a FIXED path (os.tmpdir()/
 *   fleet-coverage-scratch) that EVERY run wiped on entry
 *   (`safeDeleteSync(COVERAGE_SCRATCH_DIR)` in executeTestSuites). When two
 *   cover runs overlapped, run B's startup wipe deleted a VARIABLE subset of
 *   run A's already-accumulated raw child V8 dumps — so the child-fragment
 *   count the merge captured swung run-to-run (observed 11 vs 4436, and
 *   ~1105 vs ~2246 in the field). Fewer captured fragments → the
 *   subprocess-only entrypoints read as less-covered → the reported aggregate
 *   wobbled ~0.2pt and flipped the cover gate on measurement noise. In the
 *   worst case the wipe removed the vitest v8 provider's `.tmp` mid-run and
 *   ENOENT-crashed the entire report (0.00%). Isolation removes the shared
 *   mutable state entirely: the measurement is deterministic by construction,
 *   not by best-effort mutual exclusion (two runs can start close enough that
 *   any active-run gate races).
 *   `??=` preserves a value the parent already set, so the re-exec and the
 *   vitest children all agree on the one dir the parent chose. Non-cover
 *   consumers that never set the env (e.g. scripts/repo/measure-one-enforcer)
 *   keep the fixed default via paths.mts's fallback — they don't accumulate
 *   raw dumps across a concurrent run the way cover does.
 *   The env-name string is duplicated (a literal) in scripts/fleet/paths.mts's
 *   COVERAGE_SCRATCH_DIR fallback: importing this module there would fire this
 *   side effect for every paths.mts consumer, not just cover. Keep the two
 *   literals in lockstep — same fleet pattern as FLEET_CHILD_V8_COVERAGE_DIR.
 */

import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// The environment contract paths.mts reads to anchor COVERAGE_SCRATCH_DIR.
export const FLEET_COVERAGE_SCRATCH_DIR_ENV = 'FLEET_COVERAGE_SCRATCH_DIR'

// The per-run-unique scratch dir for a cover process. Pure so it is unit
// testable: same (pid, token) → same dir (the whole process tree agrees);
// different tokens → different dirs (two concurrent runs never collide).
// Rooted at `fleet-coverage-runs`, NOT the legacy `fleet-coverage-scratch`
// (paths.mts's fixed fallback): a pre-fix cover run recursively wipes the
// legacy root on startup, so a per-run dir NESTED under it would be clobbered
// mid-run while the fleet is mid-rollout. A separate root the old code never
// touches makes the isolation hold even against a concurrent old-code run.
export function computeRunScratchDir(pid: number, token: string): string {
  return path.join(os.tmpdir(), 'fleet-coverage-runs', `run-${pid}-${token}`)
}

// Import-time side effect: pin a per-run dir the first time, before paths.mts
// reads the env. `??=` preserves a value the parent already set so the re-exec
// and the spawned vitest tiers all inherit the one dir the parent chose.
process.env[FLEET_COVERAGE_SCRATCH_DIR_ENV] ??= computeRunScratchDir(
  process.pid,
  crypto.randomBytes(6).toString('hex'),
)
