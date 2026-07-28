/**
 * @file Promotion runners for the post-hard-stop pipeline: the separate
 *   explicit approve step (npm-publish.mts --approve --no-release) and the
 *   final tag + immutable GH release, cut LAST only behind a passed approve
 *   receipt and a live registry version. Never passes a one-time 2FA code on
 *   the CLI; assets come from the verify-time checksum stash so the immutable
 *   release is created WITH them in one shot.
 */

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { hashTarball } from '../../lib/verify-release-hashes.mts'
import { formatReleaseGapFailure } from '../../_shared/release-gap-recovery.mts'
import { readPkg, resolveSeams } from '../seams.mts'

import type { RunnerSeams, StageOutcome } from '../seams.mts'
import type { ReleaseChecksums, StageReceipt } from '../state.mts'

// ── separate explicit step: approve ────────────────────────────────────────

/**
 * Approve: promote the staged package to public. A SEPARATE explicit
 * invocation, never part of `run`. Defers to `npm-publish.mts --approve
 * --no-release`, which re-verifies every selected entry (verifyStagedEntry)
 * and runs the Socket full-scan gate before any `pnpm stage approve`; 2FA is
 * browser web-OTP — the pipeline never passes a one-time code on the CLI.
 * `--no-release` keeps the tag + GH release with the pipeline's own release
 * stage (which the same --approve invocation continues into on success),
 * where the verify-time checksums and the registry-liveness gate live.
 */
export async function runApproveStep(config: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  const args = ['scripts/fleet/npm-publish.mts', '--approve', '--no-release']
  if (cfg.dryRun) {
    args.push('--dry-run')
  }
  const code = await seams.runInherit('node', args, cfg.cwd)
  if (code !== 0) {
    return {
      detail:
        `npm-publish.mts --approve exited ${code}.\n` +
        `  Fix: read its output above (verify gate? scan gate? 2FA?), resolve, re-run --approve.`,
      status: 'failed',
    }
  }
  return {
    detail: cfg.dryRun
      ? '[dry-run] approve preview (no promote)'
      : 'staged package approved — public on npm',
    status: 'passed',
  }
}

// ── final stage: tag + immutable GH release (cut LAST) ─────────────────────

/**
 * True when an approve receipt licenses the release stage: a real (or, under
 * a dry-run walk, dry) PASSED approve keyed at the target version. Pure —
 * exported for tests.
 */
export function approveReceiptLicensesRelease(
  receipt: StageReceipt | undefined,
  config: { dryRun: boolean; targetVersion: string },
): boolean {
  const cfg = { __proto__: null, ...config } as typeof config
  return (
    !!receipt &&
    receipt.status === 'passed' &&
    receipt.key === cfg.targetVersion &&
    (cfg.dryRun || !receipt.dryRun)
  )
}

/**
 * Prepare the release assets from the verify-time checksum stash: locate (or
 * re-pack) the tarball, assert its sha1 still matches the VERIFIED digest —
 * never attach divergent bytes — and write checksums.txt beside it. Returns
 * the asset paths, or an error detail. The assets exist BEFORE the release is
 * created, so ensureTagAndRelease's draft → upload → undraft lands them in
 * one shot (an immutable release 422-rejects uploads after creation).
 */
async function prepareStashedAssets(config: {
  checksums: ReleaseChecksums
  cwd: string
  packTarball: (name: string, version: string) => Promise<string | undefined>
  pkgName: string
}): Promise<{ assets: string[]; error?: undefined } | { error: string }> {
  const cfg = { __proto__: null, ...config } as typeof config
  const { checksums } = cfg
  let tarballPath: string | undefined = path.join(
    cfg.cwd,
    checksums.tarballName,
  )
  if (!existsSync(tarballPath)) {
    tarballPath = await cfg.packTarball(cfg.pkgName, checksums.version)
  }
  if (!tarballPath || !existsSync(tarballPath)) {
    return {
      error:
        `no release tarball to attach.\n` +
        `  Where: expected ${checksums.tarballName} in ${cfg.cwd} (or a successful re-pack).\n` +
        `  Fix: re-run the verify stage (it packs + stashes the checksums), then re-run --approve.`,
    }
  }
  const digest = hashTarball(tarballPath)
  if (digest.shasum !== checksums.sha1) {
    return {
      error:
        `release tarball diverged from the verify-time bytes.\n` +
        `  Saw sha1 ${digest.shasum}, wanted the verified ${checksums.sha1}.\n` +
        `  Fix: the tree changed since verify — re-run the publish pipeline from verify; never release divergent bytes.`,
    }
  }
  const checksumsPath = path.join(cfg.cwd, 'checksums.txt')
  writeFileSync(
    checksumsPath,
    `sha1: ${checksums.sha1}  ${checksums.tarballName}\n` +
      `sha512-base64: ${checksums.sha512}  ${checksums.tarballName}\n`,
  )
  return { assets: [tarballPath, checksumsPath] }
}

/**
 * Release stage: tag vX.Y.Z + the IMMUTABLE GitHub release (3-step draft →
 * upload → undraft), owned by publish-infra/release.mts ensureTagAndRelease.
 * Cut LAST — the final marker of a release. REFUSES without a passed approve
 * receipt for this version (a STAGED package is not published; staging may
 * never be approved), and belt-and-braces REFUSES unless the version is
 * actually resolvable on the registry (the near-miss: an immutable release
 * cut before a stage-publish that then failed on auth — a release with no
 * artifact). Assets come from the verify-time checksum stash so the release
 * is created WITH them in one shot. Idempotent: an existing tag/release is
 * left untouched. Verifies the release exists afterwards (`gh release view`
 * — read the published state, don't assume).
 */
export async function runReleaseStage(config: {
  approveReceipt: StageReceipt | undefined
  cwd: string
  dryRun: boolean
  releaseChecksums?: ReleaseChecksums | undefined
  seams?: RunnerSeams | undefined
  targetVersion: string
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  if (
    !approveReceiptLicensesRelease(cfg.approveReceipt, {
      dryRun: cfg.dryRun,
      targetVersion: cfg.targetVersion,
    })
  ) {
    const saw = cfg.approveReceipt
      ? `approve ${cfg.approveReceipt.status} (key ${cfg.approveReceipt.key}${cfg.approveReceipt.dryRun ? ', dry-run' : ''})`
      : 'no approve receipt'
    return {
      detail:
        `no passed approve receipt for ${cfg.targetVersion} — refusing to cut the tag + GH release.\n` +
        `  Saw ${saw}; wanted a real passed approve keyed at ${cfg.targetVersion}.\n` +
        `  The immutable release is the FINAL marker: it may only follow the confirmed registry publish.\n` +
        `  Fix: run \`node scripts/fleet/publish-pipeline.mts --approve\` — the release follows in the same invocation.`,
      status: 'failed',
    }
  }
  const pkg = readPkg(cfg.cwd)
  if (pkg.version !== cfg.targetVersion) {
    return {
      detail:
        `package.json reads ${pkg.version}, not the named ${cfg.targetVersion}.\n` +
        `  Fix: the bump stage must land first; re-run the pipeline.`,
      status: 'failed',
    }
  }
  const tagName = `v${cfg.targetVersion}`
  if (cfg.dryRun) {
    return {
      detail: `[dry-run] would gate on registry liveness, then ensure tag ${tagName} + immutable GH release (draft → upload → undraft)`,
      status: 'deferred',
    }
  }
  // Belt-and-braces: the version must be LIVE on the registry — an approve
  // exit code alone is not proof the publish landed.
  const live = await seams.registryLive(pkg.name, pkg.version)
  if (!live) {
    return {
      detail:
        `${pkg.name}@${pkg.version} is not resolvable on the registry — refusing to cut the tag + GH release.\n` +
        `  Fix: confirm the publish actually completed (approve rejected? auth?), then re-run --approve.`,
      status: 'failed',
    }
  }
  // Prepare the assets BEFORE creating the release (one-shot draft → upload →
  // undraft), from the verify-time checksum stash when it matches this
  // version; without a stash ensureTagAndRelease falls back to its own pack.
  let ensureOptions: { packAssets: () => Promise<string[]> } | undefined
  if (cfg.releaseChecksums?.version === cfg.targetVersion) {
    const prepared = await prepareStashedAssets({
      checksums: cfg.releaseChecksums,
      cwd: cfg.cwd,
      packTarball: seams.packTarball,
      pkgName: pkg.name,
    })
    if (prepared.error !== undefined) {
      return { detail: prepared.error, status: 'failed' }
    }
    const { assets } = prepared
    ensureOptions = { packAssets: () => Promise.resolve(assets) }
  }
  const ensured = await seams.ensureRelease(
    { name: pkg.name, version: pkg.version },
    ensureOptions,
  )
  if (ensured === false) {
    return {
      detail: formatReleaseGapFailure({
        name: pkg.name,
        registry: 'npm',
        saw: 'ensureTagAndRelease reported failure (its step error is logged above)',
        version: pkg.version,
        where: 'release-pipeline release stage (release-runners/promote.mts)',
      }),
      status: 'failed',
    }
  }
  const view = await seams.runCapture(
    'gh',
    ['release', 'view', tagName, '--json', 'tagName,isDraft'],
    cfg.cwd,
  )
  if (view.code !== 0) {
    return {
      detail: formatReleaseGapFailure({
        name: pkg.name,
        registry: 'npm',
        saw: `gh release view ${tagName} exited ${view.code} right after ensureTagAndRelease reported success`,
        version: pkg.version,
        where: 'release-pipeline release stage (release-runners/promote.mts)',
      }),
      status: 'failed',
    }
  }
  return {
    detail: `tag ${tagName} + immutable GH release present (gh release view), cut after the live registry publish`,
    status: 'passed',
  }
}
