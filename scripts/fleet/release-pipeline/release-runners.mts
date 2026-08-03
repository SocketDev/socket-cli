/**
 * @file Post-hard-stop stage runners, assembled from the per-phase leaf
 *   modules under `release-runners/`: staging (bump + staged npm publish),
 *   verify (pre-approve integrity gate + registry-truth reconcile), and
 *   promote (the separate explicit approve step + the final tag + immutable
 *   GH release, cut LAST). The pipeline NEVER writes a version number and
 *   NEVER passes a one-time 2FA code on the CLI. This module is the thin
 *   re-export barrel its callers (release-pipeline.mts + the tests) import.
 */

export { runBumpStage, runStagePublish } from './release-runners/staging.mts'
export {
  runVerifyStage,
  verifyAgainstRegistry,
} from './release-runners/verify.mts'
export type { RegistryTruth } from './release-runners/verify.mts'
export {
  approveReceiptLicensesRelease,
  runApproveStep,
  runReleaseStage,
} from './release-runners/promote.mts'
