/**
 * @file The SCAN stage: between verify and approve, send the staged artifact
 *   off to be inspected and record what came back. The owner's rule
 *   (2026-08-04): "when we have something staged we can send its tarball off
 *   to be inspected and get a result — we should do that before accepting."
 *   The stage downloads the STAGED tarball by its stage id (`pnpm stage
 *   download <stageId>`, the id the verify stage recorded on its receipt) and
 *   submits it as a `tmp` Socket full scan through the SDK — the same gate
 *   npm-publish.mts already runs inside `--approve`, hoisted into its own
 *   receipt-producing stage so the verdict is recorded BEFORE a human is asked
 *   to promote, and so `--approve` can refuse when no scan stands behind the
 *   bytes. When the stage id is unavailable (an older receipt, or a version
 *   already public) it falls back to the local pack, which the verify stage
 *   has already proven byte-identical to the staged upload; the receipt names
 *   which source was scanned either way.
 *   SCOPE, precisely: the archive full scan evaluates the tarball's DEPENDENCY
 *   graph (every bundled manifest + lockfile as shipped) against the org's own
 *   security policy. It does NOT analyze the package's own novel source code —
 *   Socket's code/malware analysis is keyed to PUBLISHED packages by purl, and
 *   these bytes are not public yet. The optional local code-threat leg
 *   (`--threat-scan` on npm-publish.mts) is the arm for that and is not part of
 *   this stage.
 *   POLICY: `error`-action alerts FAIL the stage (and therefore the pipeline);
 *   `warn`-action alerts pass with the counts in the receipt. An unreachable
 *   scan is `blocked`, never a pass — no evidence is not a clean verdict.
 */

import { composeTarballProviders } from '../../publish-infra/npm/staged.mts'
import { readPkg, resolveSeams } from '../seams.mts'

import type { TarballProvider } from '../../publish-infra/npm/staged.mts'
import type { RunnerSeams, StageOutcome } from '../seams.mts'
import type { StageReceipt } from '../state.mts'

/**
 * The receipt detail a `--skip-scan` run records. Deliberately shouty and
 * self-describing: this receipt is what licenses the approve, so anyone
 * reading `--status` afterwards must see at a glance that the promoted bytes
 * carry NO scan evidence.
 */
export const SKIP_SCAN_DETAIL =
  'SCAN SKIPPED (--skip-scan) — these staged bytes carry NO Socket scan evidence. ' +
  'The approve that follows is UNSCANNED by explicit operator choice; nothing ' +
  'inspected the tarball, and no policy was evaluated against it.'

/**
 * True when a scan receipt licenses the approve step: a `passed` scan (clean,
 * or warn-only) or a `deferred` one (the explicit `--skip-scan` escape, and
 * the dry-run walk) keyed at this target version. A missing, failed, blocked,
 * stale-key, or dry-run receipt does NOT — the same shape
 * `approveReceiptLicensesRelease` uses for the release stage, one link earlier
 * in the chain. Pure — exported for tests.
 */
export function scanReceiptLicensesApprove(
  receipt: StageReceipt | undefined,
  config: { dryRun: boolean; targetVersion: string },
): boolean {
  const cfg = { __proto__: null, ...config } as typeof config
  return (
    !!receipt &&
    (receipt.status === 'deferred' || receipt.status === 'passed') &&
    receipt.key === cfg.targetVersion &&
    (cfg.dryRun || !receipt.dryRun)
  )
}

/**
 * Scan stage: inspect the staged artifact and record the verdict. Runs after
 * verify (which proves the staged bytes are the ones this tree produced, and
 * hands over the stage id) and before approve (which refuses without a scan
 * receipt). Never promotes, never mutates the tree.
 */
export async function runScanStage(config: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
  // The explicit escape hatch: skip the scan and say so loudly in the receipt.
  skipScan?: boolean | undefined
  // The npm stage id the verify stage recorded, when it had one.
  stageId?: string | undefined
  targetVersion: string
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  if (cfg.dryRun) {
    return {
      detail:
        '[dry-run] nothing is staged under dry-run, so the scan has no subject',
      status: 'deferred',
    }
  }
  if (cfg.skipScan === true) {
    return { detail: SKIP_SCAN_DETAIL, status: 'deferred' }
  }
  const pkg = readPkg(cfg.cwd)
  // One auth preflight up front: a missing/expired token must read as "no
  // evidence" (blocked — stops the run, never satisfies a resume), not as a
  // clean scan. This is the same distinction the verify stage draws for an
  // unauthenticated stage list.
  const context = await seams.scanAuth()
  if (!context) {
    return {
      detail:
        `the Socket scan gate is unavailable — no verdict on ${pkg.name}@${cfg.targetVersion}.\n` +
        `  Where: the scan-stage auth preflight (token + org resolution; see its output above)\n` +
        `  Not recording a scan verdict: an unreachable gate is missing evidence, not a clean scan.\n` +
        `  Fix: export a Socket API token (SOCKET_API_TOKEN) and re-run — receipts resume at scan; ` +
        `--skip-scan promotes without scan evidence, and says so in the receipt.`,
      status: 'blocked',
    }
  }
  // Artifact source, in precedence order: the STAGED upload's own bytes (what
  // npm actually holds), then the local pack the verify stage already proved
  // byte-identical to it. A source that yields nothing falls through instead
  // of failing the stage; only an empty chain refuses.
  let source = 'no artifact source yielded bytes'
  const sources: TarballProvider[] = []
  const { stageId } = cfg
  if (stageId) {
    sources.push(async () => {
      const downloaded = await seams.downloadStagedTarball(stageId)
      if (downloaded) {
        source = `the staged upload itself (pnpm stage download ${stageId})`
      }
      return downloaded
    })
  }
  sources.push(async (name, version) => {
    const packed = await seams.packTarball(name, version)
    if (packed) {
      source =
        'a local pack (the verify stage proved it byte-identical to the staged upload)'
    }
    return packed
  })
  const verdict = await seams.scanEntry(
    { name: pkg.name, version: cfg.targetVersion },
    { context, packTarball: composeTarballProviders(sources) },
  )
  if (!verdict.ok) {
    return {
      detail:
        `Socket scan REFUSED ${pkg.name}@${cfg.targetVersion} — not approving these bytes.\n` +
        `  Where: ${verdict.detail}\n` +
        `  Scanned: ${source}\n` +
        `  Fix: resolve the blocking alerts (or reject the staged upload: ` +
        `node scripts/fleet/npm-web-auth.mts stage reject ${stageId ?? '<stageId>'}) and re-stage. ` +
        `--skip-scan promotes without scan evidence, and says so in the receipt.`,
      status: 'failed',
    }
  }
  const warnNote = verdict.warnAlerts.length
    ? ` — WARN (non-blocking): ${verdict.warnAlerts
        .map(alert => `${alert.type} (${alert.severity}) in ${alert.artifact}`)
        .join(', ')}`
    : ''
  return {
    detail: `${verdict.detail}; scanned ${source}${warnNote}`,
    status: 'passed',
  }
}
