/**
 * @file Post-hard-stop stage runners: bump (bump.mts owns the version write),
 *   staged npm publish (REMOTE-FIRST: dispatch + watch the npm-publish.yml
 *   workflow so the staged upload runs in CI under OIDC; `--local` is the
 *   explicit offline escape into npm-publish.mts --staged), the pre-approve
 *   verify gate (verifyStagedEntry, which also stashes the release-asset
 *   checksums), the separate explicit approve step (npm-publish.mts --approve
 *   --no-release), and the tag + immutable GH release (ensureTagAndRelease) —
 *   cut LAST, only behind a passed approve receipt and a live registry version.
 *   The pipeline NEVER writes a version number and NEVER passes a one-time 2FA
 *   code on the CLI.
 */

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { hashTarball } from '../lib/verify-release-hashes.mts'
import { resolveBumpScript } from '../publish-infra/npm/bump.mts'
import { StageListAuthError } from '../publish-infra/npm/shared.mts'
import { buildWorkflowRunArgs } from '../publish-infra/remote-dispatch.mts'
import {
  buildNpmPublishSpec,
  NPM_PUBLISH_WORKFLOW,
} from '../publish-infra/remote-npm-publish.mts'
import { headIsOnOrigin } from './gate-runners.mts'
import { readPkg, resolveSeams } from './seams.mts'
import { deriveReleaseLevel } from './stages.mts'

import type { StageListEntry } from '../publish-infra/npm/shared.mts'
import type { RunnerSeams, StageOutcome } from './seams.mts'
import type { ReleaseChecksums, StageReceipt } from './state.mts'

// ── stage 7: bump ──────────────────────────────────────────────────────────

/**
 * Bump stage: translate the USER-named version into the `--release-as` level
 * that makes bump.mts land exactly there, run bump.mts (the sole owner of
 * the version write + CHANGELOG + bump commit), then verify package.json
 * actually reads the named version. The pipeline never writes a version.
 */
export async function runBumpStage(config: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
  targetVersion: string
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  const pkg = readPkg(cfg.cwd)
  if (pkg.version === cfg.targetVersion) {
    return {
      detail: `package.json already reads ${cfg.targetVersion} — bump previously applied`,
      status: 'passed',
    }
  }
  const derived = deriveReleaseLevel(pkg.version, cfg.targetVersion)
  if (derived.error !== undefined) {
    return { detail: derived.error, status: 'failed' }
  }
  // Overlay-first: a repo-specific scripts/repo/bump.mts (monorepo / custom
  // bumps, e.g. socket-registry's publishConfig.directory subject) wins over
  // the canonical scripts/fleet/bump.mts — same precedence as the CI bump.
  const args = [resolveBumpScript(cfg.cwd), '--release-as', derived.level]
  if (cfg.dryRun) {
    args.push('--dry-run')
  }
  const code = await seams.runInherit('node', args, cfg.cwd)
  if (code !== 0) {
    return {
      detail:
        `bump.mts exited ${code}.\n` +
        `  Fix: read its error above (empty changelog? version policy?), resolve, re-run.`,
      status: 'failed',
    }
  }
  if (cfg.dryRun) {
    return {
      detail: `[dry-run] bump.mts preview for ${cfg.targetVersion} (--release-as ${derived.level})`,
      status: 'passed',
    }
  }
  const after = readPkg(cfg.cwd)
  if (after.version !== cfg.targetVersion) {
    return {
      detail:
        `bump landed on the wrong version.\n` +
        `  Where: package.json after bump.mts --release-as ${derived.level}\n` +
        `  Saw ${after.version}, wanted ${cfg.targetVersion}.\n` +
        `  Fix: reconcile the named version with bump.mts's computation (it increments from ${pkg.version}).`,
      status: 'failed',
    }
  }
  return {
    detail: `bump.mts committed chore: bump version to ${cfg.targetVersion} (--release-as ${derived.level})`,
    status: 'passed',
  }
}

// ── stage 8: staged npm publish ────────────────────────────────────────────

// How long the runner waits for the dispatched npm-publish.yml run to appear
// in `gh run list` (GitHub creates the run asynchronously after the dispatch
// accepts). 24 × 5s = 2 minutes, far beyond the observed single-digit-second
// lag.
const DISPATCHED_RUN_POLL_INTERVAL_MS = 5000
const DISPATCHED_RUN_POLL_ATTEMPTS = 24

/**
 * The newest npm-publish.yml run id, or undefined when there is none (or the
 * listing failed — the caller treats both the same: no observable run yet).
 */
async function latestPublishRunId(
  seams: { runCapture: ResolvedRunCapture },
  cwd: string,
): Promise<string | undefined> {
  const list = await seams.runCapture(
    'gh',
    [
      'run',
      'list',
      '--workflow',
      NPM_PUBLISH_WORKFLOW,
      '--json',
      'databaseId',
      '--limit',
      '1',
    ],
    cwd,
  )
  if (list.code !== 0) {
    return undefined
  }
  try {
    const runs = JSON.parse(list.stdout || '[]') as Array<{
      databaseId?: number | string | undefined
    }>
    const id = runs[0]?.databaseId
    return id === undefined ? undefined : String(id)
  } catch {
    return undefined
  }
}

type ResolvedRunCapture = (
  cmd: string,
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; code: number }>

/**
 * Stage-publish, REMOTE-FIRST: dispatch the repo's npm-publish.yml workflow
 * (`gh workflow run` — the staged upload then runs in CI under the OIDC
 * trusted-publisher token, no local npm login) and WATCH the run to
 * completion. Staging is server-side on npm, so the verify stage sees the
 * staged entry regardless of where the upload ran. `local: true` is the
 * explicit offline escape: defer to the owning local runner
 * (`npm-publish.mts --staged`) from this machine instead. Either way nothing
 * goes public here; auth is browser-based (web) — never an --otp flag.
 */
export async function runStagePublish(config: {
  cwd: string
  distTag: string
  dryRun: boolean
  // Explicit --local escape for genuinely offline use: stage from THIS
  // machine via npm-publish.mts --staged instead of dispatching CI.
  local?: boolean | undefined
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  if (cfg.local === true) {
    return await runLocalStagePublish(cfg, seams)
  }
  const spec = buildNpmPublishSpec({
    // The pipeline never backfills — gap-fill republishes are a deliberate
    // manual dispatch of npm-publish.yml (see publish-infra/npm/backfill.mts).
    backfillVersion: undefined,
    // The pipeline's bump stage already landed the bump commit (the runner
    // refuses to dispatch from an unpushed head), so the workflow's CI bump
    // step must NOT run again: the whole chain bumps exactly once. A
    // re-entrant CI bump once re-derived the same version and committed a
    // duplicate 6.2.1 CHANGELOG section.
    bump: false,
    checkoutRef: undefined,
    distTag: cfg.distTag,
    dryRun: false,
    publish: true,
    ref: undefined,
    releaseAs: undefined,
    repo: undefined,
  })
  if (cfg.dryRun) {
    return {
      detail:
        `[dry-run] would dispatch \`gh ${buildWorkflowRunArgs(spec).join(' ')}\` ` +
        `and watch the run (CI stages under OIDC; --local stages from this machine)`,
      status: 'passed',
    }
  }
  // The dispatched workflow checks out the ORIGIN default branch — an unpushed
  // bump commit would stage the wrong version. Fail early, not in CI.
  const head = await seams.runCapture('git', ['rev-parse', 'HEAD'], cfg.cwd)
  const sha = head.stdout.trim()
  if (!(await headIsOnOrigin(sha, cfg.cwd, seams))) {
    return {
      detail:
        `HEAD ${sha.slice(0, 12)} (the bump commit) is not on origin — the dispatched ` +
        `${NPM_PUBLISH_WORKFLOW} run stages from the origin default branch.\n` +
        `  Fix: push the bump commit, then re-run; or re-run with --local for a genuinely offline staging.`,
      status: 'failed',
    }
  }
  // Baseline BEFORE dispatching so the watcher can tell the new run apart
  // from a previous one of the same workflow.
  const baseline = await latestPublishRunId(seams, cfg.cwd)
  const dispatched = await seams.runInherit(
    'gh',
    buildWorkflowRunArgs(spec),
    cfg.cwd,
  )
  if (dispatched !== 0) {
    return {
      detail:
        `\`gh workflow run ${NPM_PUBLISH_WORKFLOW}\` exited ${dispatched}.\n` +
        `  Fix: check \`gh auth status\` and that ${NPM_PUBLISH_WORKFLOW} exists on the origin default branch, then re-run.`,
      status: 'failed',
    }
  }
  let runId: string | undefined
  for (let i = 0; i < DISPATCHED_RUN_POLL_ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- polling is strictly sequential.
    await seams.sleep(DISPATCHED_RUN_POLL_INTERVAL_MS)
    // eslint-disable-next-line no-await-in-loop -- polling is strictly sequential.
    const id = await latestPublishRunId(seams, cfg.cwd)
    if (id !== undefined && id !== baseline) {
      runId = id
      break
    }
  }
  if (runId === undefined) {
    return {
      detail:
        `dispatched ${NPM_PUBLISH_WORKFLOW}, but no new run appeared in \`gh run list\` ` +
        `after ${Math.round((DISPATCHED_RUN_POLL_ATTEMPTS * DISPATCHED_RUN_POLL_INTERVAL_MS) / 1000)}s.\n` +
        `  Fix: check the repo's Actions tab; when the run exists, re-run — the verify stage picks up the staged entry.`,
      status: 'failed',
    }
  }
  const watched = await seams.runInherit(
    'gh',
    ['run', 'watch', runId, '--exit-status'],
    cfg.cwd,
  )
  if (watched !== 0) {
    return {
      detail:
        `${NPM_PUBLISH_WORKFLOW} run ${runId} FAILED (gh run watch exited ${watched}).\n` +
        `  Fix: read \`gh run view ${runId} --log-failed\`, resolve, re-run.`,
      status: 'failed',
    }
  }
  return {
    detail: `staged to npm by ${NPM_PUBLISH_WORKFLOW} run ${runId} (tag ${cfg.distTag}); not public until --approve`,
    status: 'passed',
  }
}

/**
 * The --local staging leg: defer to the owning publish runner
 * (`npm-publish.mts --staged`), which refuses already-published versions
 * (registry read first) and adds --provenance under GITHUB_ACTIONS.
 */
async function runLocalStagePublish(
  cfg: { cwd: string; distTag: string; dryRun: boolean },
  seams: { runInherit: (c: string, a: string[], d: string) => Promise<number> },
): Promise<StageOutcome> {
  const args = [
    'scripts/fleet/npm-publish.mts',
    '--staged',
    '--tag',
    cfg.distTag,
  ]
  if (cfg.dryRun) {
    args.push('--dry-run')
  }
  const code = await seams.runInherit('node', args, cfg.cwd)
  if (code !== 0) {
    return {
      detail:
        `npm-publish.mts --staged exited ${code}.\n` +
        `  Fix: read its error above (already published? auth? pack failure?), resolve, re-run.`,
      status: 'failed',
    }
  }
  return {
    detail: cfg.dryRun
      ? '[dry-run] pnpm stage publish validated pack + manifest, no upload (--local)'
      : `staged to npm from this machine (--local, tag ${cfg.distTag}); not public until --approve`,
    status: 'passed',
  }
}

// ── stage 9: pre-approve verify ────────────────────────────────────────────

/**
 * Verify stage: the pre-approve integrity gate. Finds this package's staged
 * entry (`pnpm stage list --json`) and runs verifyStagedEntry — local pack
 * sha1 vs npm's staged shasum, with the extracted-contents fallback. A
 * mismatch fails loud; approve is unreachable until this passes. On a pass,
 * the outcome carries the release-asset checksums (sha1 + sha512 of the
 * verified local pack) for the state stash — the release stage creates the
 * immutable GH release WITH those assets in one shot, never uploading after
 * creation.
 */
export async function runVerifyStage(config: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
  targetVersion: string
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  if (cfg.dryRun) {
    return {
      detail: '[dry-run] nothing staged under dry-run; verify has no subject',
      status: 'deferred',
    }
  }
  const pkg = readPkg(cfg.cwd)
  let staged: StageListEntry[]
  try {
    staged = await seams.listStaged()
  } catch (e) {
    if (!(e instanceof StageListAuthError)) {
      throw e
    }
    // No npm auth: the staged listing has NO evidence either way — an
    // unauthenticated `pnpm stage list` parses as EMPTY. Recording that as
    // verify=failed "0 staged entries" is the 6.2.1 false negative. One
    // authenticated-source fallback exists: when the version is ALREADY LIVE
    // on the registry, PUBLIC reads (packument digests + published tarball)
    // verify the bytes without local auth. Otherwise the honest outcome is
    // `blocked` (stops the run, never satisfies a resume) — a staged-but-
    // unpublished entry's digest is only visible authenticated.
    const truth = await verifyAgainstRegistry({
      cwd: cfg.cwd,
      seams: cfg.seams,
      targetVersion: cfg.targetVersion,
    })
    if (truth.status === 'match') {
      return {
        detail: `${truth.detail} — verified from PUBLIC registry reads (no npm auth needed)`,
        releaseChecksums: truth.releaseChecksums,
        status: 'passed',
      }
    }
    if (truth.status === 'mismatch') {
      // The version IS observable without auth and the bytes diverge (or
      // can't be compared) — that is a real verify failure, not missing
      // evidence.
      return {
        detail:
          `registry-truth verify FAILED for ${pkg.name}@${cfg.targetVersion}.\n` +
          `  Where: ${truth.detail}\n` +
          `  Fix: never release divergent bytes — reconcile the tree with the published content, then re-run.`,
        status: 'failed',
      }
    }
    return {
      detail:
        `staged-entry listing is UNAUTHENTICATED — verify has no evidence either way.\n` +
        `  Where: ${e.message}\n` +
        `  Not recording a verify verdict: a missing local token is not an integrity failure ` +
        `(and ${pkg.name}@${cfg.targetVersion} is not live on the registry, so no public fallback exists).\n` +
        `  Fix: authenticate npm (npm login / browser web-OTP), then re-run the verify stage.`,
      status: 'blocked',
    }
  }
  const entry = staged.find(
    e => e.name === pkg.name && e.version === cfg.targetVersion,
  )
  if (!entry) {
    return {
      detail:
        `no staged entry for ${pkg.name}@${cfg.targetVersion}.\n` +
        `  Where: pnpm stage list --json (${staged.length} entr${staged.length === 1 ? 'y' : 'ies'} total)\n` +
        `  Fix: run the stage-publish stage first, and check npm auth (pnpm stage list).`,
      status: 'failed',
    }
  }
  const ok = await seams.verifyEntry(entry)
  if (!ok) {
    return {
      detail:
        `pre-approve verify FAILED for ${pkg.name}@${cfg.targetVersion} (see the gate's log above).\n` +
        `  Fix: reject the staged upload (pnpm stage reject ${entry.stageId}) and re-stage — never approve divergent bytes.`,
      status: 'failed',
    }
  }
  // Compute the release-asset checksums NOW, over the verified local pack —
  // the release stage attaches these exact bytes to the immutable release.
  const tarballName = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${cfg.targetVersion}.tgz`
  let tarballPath: string | undefined = path.join(cfg.cwd, tarballName)
  if (!existsSync(tarballPath)) {
    // The verify gate's internal pack usually leaves the tarball in cwd; a
    // custom verify seam may not — pack once more.
    tarballPath = await seams.packTarball(pkg.name, cfg.targetVersion)
  }
  if (!tarballPath || !existsSync(tarballPath)) {
    return {
      detail:
        `verified ${pkg.name}@${cfg.targetVersion}, but no tarball to checksum for the release assets.\n` +
        `  Where: expected ${tarballName} in ${cfg.cwd} (or a successful re-pack).\n` +
        `  Fix: fix the pack, re-run — the release stage refuses without stashed checksums-backed assets.`,
      status: 'failed',
    }
  }
  const digest = hashTarball(tarballPath)
  return {
    detail: `staged shasum verified for ${pkg.name}@${cfg.targetVersion} (stageId ${entry.stageId}); release checksums stashed (sha1 ${digest.shasum})`,
    releaseChecksums: {
      sha1: digest.shasum,
      sha512: digest.integrity.replace(/^sha512-/, ''),
      tarballName,
      version: cfg.targetVersion,
    },
    status: 'passed',
  }
}

// ── registry truth (already-published reconcile) ───────────────────────────

/**
 * What a registry-truth verification concluded. `match` carries the
 * release-asset checksums computed over the verified local re-pack, so the
 * caller can mint a verify receipt exactly the way runVerifyStage does.
 */
export type RegistryTruth =
  | { detail: string; releaseChecksums: ReleaseChecksums; status: 'match' }
  | { detail: string; status: 'mismatch' }
  | { detail: string; status: 'not-live' }

/**
 * Verify a version that is ALREADY LIVE on the registry from PUBLIC reads —
 * no npm auth. Re-packs at the bump commit (package.json must read the
 * target version) and compares against the packument `dist` digests. The
 * gzip envelope is platform-sensitive — a CI-published tarball and a local
 * re-pack legitimately wrap identical contents differently — so a digest
 * mismatch falls back to downloading the published tarball and comparing
 * EXTRACTED CONTENTS, the same honest axis verifyStagedEntry uses. This is
 * the sanctioned reconcile evidence for a pipeline whose verify/approve
 * receipts went missing after the version already shipped (the 6.2.1
 * strand): registry truth, never a rubber stamp — divergent bytes refuse.
 */
export async function verifyAgainstRegistry(config: {
  cwd: string
  seams?: RunnerSeams | undefined
  targetVersion: string
}): Promise<RegistryTruth> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  const pkg = readPkg(cfg.cwd)
  const dist = await seams.fetchRegistryDist(pkg.name)
  const live = dist[cfg.targetVersion]
  if (!live) {
    return {
      detail: `${pkg.name}@${cfg.targetVersion} is not on the registry (public packument read)`,
      status: 'not-live',
    }
  }
  if (pkg.version !== cfg.targetVersion) {
    return {
      detail:
        `package.json reads ${pkg.version}, not ${cfg.targetVersion} — the re-pack must run ` +
        `at the bump commit so the compared bytes are the published content`,
      status: 'mismatch',
    }
  }
  if (!live.shasum && !live.integrity) {
    return {
      detail: `the packument for ${pkg.name}@${cfg.targetVersion} exposes no dist.shasum/integrity to compare against`,
      status: 'mismatch',
    }
  }
  const tarballPath = await seams.packTarball(pkg.name, cfg.targetVersion)
  if (!tarballPath || !existsSync(tarballPath)) {
    return {
      detail: `could not re-pack ${pkg.name}@${cfg.targetVersion} locally for the registry compare`,
      status: 'mismatch',
    }
  }
  const digest = hashTarball(tarballPath)
  const digestMatch =
    (live.shasum !== undefined && digest.shasum === live.shasum) ||
    (live.integrity !== undefined && digest.integrity === live.integrity)
  let evidence: string
  if (digestMatch) {
    evidence = `local re-pack sha1 ${digest.shasum} matches the packument dist digest`
  } else {
    // Envelope-sensitive digests differ across platforms; compare what
    // actually ships — the extracted files — against the published tarball.
    const published = await seams.downloadRegistryTarball(
      pkg.name,
      cfg.targetVersion,
    )
    if (!published) {
      return {
        detail:
          `digest mismatch (local sha1 ${digest.shasum} vs registry ${live.shasum ?? live.integrity}) ` +
          `AND the published tarball could not be downloaded for a content compare`,
        status: 'mismatch',
      }
    }
    const contents = await seams.compareTarballContents(published, tarballPath)
    if (!contents.equal) {
      return {
        detail:
          `published contents DIVERGE from the local re-pack: ${contents.detail} ` +
          `(local sha1 ${digest.shasum}, registry ${live.shasum ?? live.integrity})`,
        status: 'mismatch',
      }
    }
    evidence = `contents byte-identical to the published tarball (${contents.detail}); only the gzip envelope differs`
  }
  return {
    detail: `registry truth for ${pkg.name}@${cfg.targetVersion}: ${evidence}`,
    releaseChecksums: {
      sha1: digest.shasum,
      sha512: digest.integrity.replace(/^sha512-/, ''),
      tarballName: path.basename(tarballPath),
      version: cfg.targetVersion,
    },
    status: 'match',
  }
}

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
  await seams.ensureRelease(
    { name: pkg.name, version: pkg.version },
    ensureOptions,
  )
  const view = await seams.runCapture(
    'gh',
    ['release', 'view', tagName, '--json', 'tagName,isDraft'],
    cfg.cwd,
  )
  if (view.code !== 0) {
    return {
      detail:
        `release ${tagName} not visible after ensureTagAndRelease (gh release view exited ${view.code}).\n` +
        `  Fix: read the ensureTagAndRelease log above, repair the tag/release, re-run.`,
      status: 'failed',
    }
  }
  return {
    detail: `tag ${tagName} + immutable GH release present (gh release view), cut after the live registry publish`,
    status: 'passed',
  }
}
