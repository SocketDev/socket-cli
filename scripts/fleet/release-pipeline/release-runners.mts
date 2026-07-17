/**
 * @file Post-hard-stop stage runners: bump (bump.mts owns the version write),
 *   tag + immutable GH release (ensureTagAndRelease), staged npm publish
 *   (npm-publish.mts --staged), the pre-approve verify gate
 *   (verifyStagedEntry), and the separate explicit approve step
 *   (npm-publish.mts --approve). The pipeline NEVER writes a version number
 *   and NEVER passes a one-time 2FA code on the CLI.
 */

import { readPkg, resolveSeams } from './seams.mts'
import { deriveReleaseLevel } from './stages.mts'

import type { RunnerSeams, StageOutcome } from './seams.mts'

// ── stage 6: bump ──────────────────────────────────────────────────────────

/**
 * Bump stage: translate the USER-named version into the `--release-as` level
 * that makes bump.mts land exactly there, run bump.mts (the sole owner of
 * the version write + CHANGELOG + bump commit), then verify package.json
 * actually reads the named version. The pipeline never writes a version.
 */
export async function runBumpStage(options: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
  targetVersion: string
}): Promise<StageOutcome> {
  const opts = { __proto__: null, ...options } as typeof options
  const seams = resolveSeams(opts.seams)
  const pkg = readPkg(opts.cwd)
  if (pkg.version === opts.targetVersion) {
    return {
      detail: `package.json already reads ${opts.targetVersion} — bump previously applied`,
      status: 'passed',
    }
  }
  const derived = deriveReleaseLevel(pkg.version, opts.targetVersion)
  if (derived.error !== undefined) {
    return { detail: derived.error, status: 'failed' }
  }
  const args = ['scripts/fleet/bump.mts', '--release-as', derived.level]
  if (opts.dryRun) {
    args.push('--dry-run')
  }
  const code = await seams.runInherit('node', args, opts.cwd)
  if (code !== 0) {
    return {
      detail:
        `bump.mts exited ${code}.\n` +
        `  Fix: read its error above (empty changelog? version policy?), resolve, re-run.`,
      status: 'failed',
    }
  }
  if (opts.dryRun) {
    return {
      detail: `[dry-run] bump.mts preview for ${opts.targetVersion} (--release-as ${derived.level})`,
      status: 'passed',
    }
  }
  const after = readPkg(opts.cwd)
  if (after.version !== opts.targetVersion) {
    return {
      detail:
        `bump landed on the wrong version.\n` +
        `  Where: package.json after bump.mts --release-as ${derived.level}\n` +
        `  Saw ${after.version}, wanted ${opts.targetVersion}.\n` +
        `  Fix: reconcile the named version with bump.mts's computation (it increments from ${pkg.version}).`,
      status: 'failed',
    }
  }
  return {
    detail: `bump.mts committed chore: bump version to ${opts.targetVersion} (--release-as ${derived.level})`,
    status: 'passed',
  }
}

// ── stage 7: tag + immutable GH release ────────────────────────────────────

/**
 * Release stage: tag vX.Y.Z + the IMMUTABLE GitHub release (3-step draft →
 * upload → undraft), owned by publish-infra/release.mts ensureTagAndRelease.
 * Idempotent: an existing tag/release is left untouched. Verifies the release
 * exists afterwards (`gh release view` — read the published state, don't
 * assume).
 */
export async function runReleaseStage(options: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
  targetVersion: string
}): Promise<StageOutcome> {
  const opts = { __proto__: null, ...options } as typeof options
  const seams = resolveSeams(opts.seams)
  const pkg = readPkg(opts.cwd)
  if (pkg.version !== opts.targetVersion) {
    return {
      detail:
        `package.json reads ${pkg.version}, not the named ${opts.targetVersion}.\n` +
        `  Fix: the bump stage must land first; re-run the pipeline.`,
      status: 'failed',
    }
  }
  const tagName = `v${opts.targetVersion}`
  if (opts.dryRun) {
    return {
      detail: `[dry-run] would ensure tag ${tagName} + immutable GH release (draft → upload → undraft)`,
      status: 'deferred',
    }
  }
  await seams.ensureRelease({ name: pkg.name, version: pkg.version })
  const view = await seams.runCapture(
    'gh',
    ['release', 'view', tagName, '--json', 'tagName,isDraft'],
    opts.cwd,
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
    detail: `tag ${tagName} + immutable GH release present (gh release view)`,
    status: 'passed',
  }
}

// ── stage 8: staged npm publish ────────────────────────────────────────────

/**
 * Stage-publish: defer to the owning publish runner
 * (`npm-publish.mts --staged`), which refuses already-published versions
 * (registry read first) and adds --provenance under GITHUB_ACTIONS. Nothing
 * goes public here; auth is browser-based (web) — never an --otp flag.
 */
export async function runStagePublish(options: {
  cwd: string
  distTag: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const opts = { __proto__: null, ...options } as typeof options
  const seams = resolveSeams(opts.seams)
  const args = [
    'scripts/fleet/npm-publish.mts',
    '--staged',
    '--tag',
    opts.distTag,
  ]
  if (opts.dryRun) {
    args.push('--dry-run')
  }
  const code = await seams.runInherit('node', args, opts.cwd)
  if (code !== 0) {
    return {
      detail:
        `npm-publish.mts --staged exited ${code}.\n` +
        `  Fix: read its error above (already published? auth? pack failure?), resolve, re-run.`,
      status: 'failed',
    }
  }
  return {
    detail: opts.dryRun
      ? '[dry-run] pnpm stage publish validated pack + manifest, no upload'
      : `staged to npm (tag ${opts.distTag}); not public until --approve`,
    status: 'passed',
  }
}

// ── stage 9: pre-approve verify ────────────────────────────────────────────

/**
 * Verify stage: the pre-approve integrity gate. Finds this package's staged
 * entry (`pnpm stage list --json`) and runs verifyStagedEntry — local pack
 * sha1 vs npm's staged shasum, with the extracted-contents fallback. A
 * mismatch fails loud; approve is unreachable until this passes.
 */
export async function runVerifyStage(options: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
  targetVersion: string
}): Promise<StageOutcome> {
  const opts = { __proto__: null, ...options } as typeof options
  const seams = resolveSeams(opts.seams)
  if (opts.dryRun) {
    return {
      detail: '[dry-run] nothing staged under dry-run; verify has no subject',
      status: 'deferred',
    }
  }
  const pkg = readPkg(opts.cwd)
  const staged = await seams.listStaged()
  const entry = staged.find(
    e => e.name === pkg.name && e.version === opts.targetVersion,
  )
  if (!entry) {
    return {
      detail:
        `no staged entry for ${pkg.name}@${opts.targetVersion}.\n` +
        `  Where: pnpm stage list --json (${staged.length} entr${staged.length === 1 ? 'y' : 'ies'} total)\n` +
        `  Fix: run the stage-publish stage first, and check npm auth (pnpm stage list).`,
      status: 'failed',
    }
  }
  const ok = await seams.verifyEntry(entry)
  if (!ok) {
    return {
      detail:
        `pre-approve verify FAILED for ${pkg.name}@${opts.targetVersion} (see the gate's log above).\n` +
        `  Fix: reject the staged upload (pnpm stage reject ${entry.stageId}) and re-stage — never approve divergent bytes.`,
      status: 'failed',
    }
  }
  return {
    detail: `staged shasum verified for ${pkg.name}@${opts.targetVersion} (stageId ${entry.stageId})`,
    status: 'passed',
  }
}

// ── separate explicit step: approve ────────────────────────────────────────

/**
 * Approve: promote the staged package to public. A SEPARATE explicit
 * invocation, never part of `run`. Defers to `npm-publish.mts --approve`,
 * which re-verifies every selected entry (verifyStagedEntry) and runs the
 * Socket full-scan gate before any `pnpm stage approve`; 2FA is browser
 * web-OTP — the pipeline never passes a one-time code on the CLI.
 */
export async function runApproveStep(options: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const opts = { __proto__: null, ...options } as typeof options
  const seams = resolveSeams(opts.seams)
  const args = ['scripts/fleet/npm-publish.mts', '--approve']
  if (opts.dryRun) {
    args.push('--dry-run')
  }
  const code = await seams.runInherit('node', args, opts.cwd)
  if (code !== 0) {
    return {
      detail:
        `npm-publish.mts --approve exited ${code}.\n` +
        `  Fix: read its output above (verify gate? scan gate? 2FA?), resolve, re-run --approve.`,
      status: 'failed',
    }
  }
  return {
    detail: opts.dryRun
      ? '[dry-run] approve preview (no promote)'
      : 'staged package approved — public on npm',
    status: 'passed',
  }
}
