/**
 * @file Staging runners for the post-hard-stop pipeline: the bump stage
 *   (bump.mts owns the version write) and the staged npm publish
 *   (REMOTE-FIRST: dispatch + watch npm-publish.yml so the upload runs in CI
 *   under OIDC; `--local` is the explicit offline escape into npm-publish.mts
 *   --staged). Nothing goes public here — staging is server-side on npm.
 */

import { resolveBumpScript } from '../../publish-infra/npm/bump.mts'
import { buildWorkflowRunArgs } from '../../publish-infra/remote-dispatch.mts'
import {
  buildNpmPublishSpec,
  NPM_PUBLISH_WORKFLOW,
} from '../../publish-infra/remote-npm-publish.mts'
import { headIsOnOrigin } from '../gate-runners.mts'
import { readPkg, resolveSeams } from '../seams.mts'
import { deriveReleaseLevel } from '../stages.mts'

import type { RunnerSeams, StageOutcome } from '../seams.mts'

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
