/*
 * @file Fleet-canonical publish runner. Three modes: --staged Upload this
 *   package's tarball to npm staging via `pnpm stage publish`. Designed to run
 *   in CI under the OIDC trusted-publisher token. Nothing publicly visible
 *   until --approve runs. Adds `--provenance` automatically when GITHUB_ACTIONS
 *   is set. THIS IS THE DEFAULT path — staging gives `pnpm stage reject` a
 *   server-side rescue for botched uploads (wrong file, wrong checksum, wrong
 *   version) before anything goes public. --approve Interactive multi-select
 *   over the user's currently-staged packages, then batch `pnpm stage approve
 *   <id>` with a single shared 2FA OTP. Designed to run locally. OTP resolution
 *   order:
 *
 *   1. `--otp <code>` flag (CI / scripted use).
 *   2. `--yes` with no `--otp` → skip the prompt; the registry challenge drives
 *      pnpm's web-OTP flow directly (browser window to npmjs.com per approve
 *      call) — the agent-driveable path: no TTY needed, the human authenticates
 *      in the browser.
 *   3. Interactive `password` prompt (lib/stdio/prompts).
 *   4. Empty prompt input → pnpm's per-call web-OTP flow (registry challenge opens
 *      a browser window to npmjs.com per approve call). --direct Classic
 *      single-step `pnpm publish` — uploads + makes public in one call, no
 *      stage/approve. Escape hatch for environments where the stage endpoint is
 *      unreachable (e.g. an SFW build without the `/-/stage/*` endpoint
 *      allowlist). Same provenance + OIDC token shape as --staged when
 *      GITHUB_ACTIONS is set. Trades server-side rejectability for fewer hops;
 *      only use when the stage path can't reach npm. Prefer --staged whenever
 *      the network allows it. --dry-run Forwarded to the underlying pnpm
 *      command. Used to preview the tarball + manifest without registry writes.
 *      The staged/approve split is a hard requirement of npm's staged-publish
 *      flow: the stage upload uses an OIDC token from CI; the approve step
 *      requires human 2FA. Combining them in one mode would either leak the OTP
 *      into CI logs or require a human at the CI keyboard. Repos with bespoke
 *      publish pipelines (socket-addon's 9-package OIDC + .node verification,
 *      socket-registry's monorepo package-npm-publish delegation, etc.) keep
 *      their own publish.mts and don't adopt this canonical version. Repos with
 *      simple single-package publishing consume this one byte-identical via the
 *      sync-scaffolding cascade.
 *
 *   This file is the thin entry: arg parsing + mode dispatch. The
 *   implementation lives under `publish-infra/`, organized in registry tiers
 *   so a future `cargo-publish.mts` slots in beside npm: the agnostic core
 *   (`publish-infra/shared.mts` — spawn/git/JSON helpers,
 *   `publish-infra/release.mts` — git tag + GitHub release) and the npm tier
 *   (`publish-infra/npm/` — registry reads, staged/direct modes, the bump
 *   step, and the approve flow).
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getCI } from '@socketsecurity/lib-stable/env/ci'

import { runApprove } from './publish-infra/npm/approve.mts'
import {
  backfillFlagConflict,
  runBackfillGate,
} from './publish-infra/npm/backfill.mts'
import {
  fetchPublishedVersion,
  findPublishedBaseSha,
  rebaseOntoPublishedBase,
  syncFromOriginMain,
} from './publish-infra/reconcile.mts'
import { resolveBumpScript, runBump } from './publish-infra/npm/bump.mts'
import {
  isStagingExpected,
  parseStageListJson,
  readPackageJson,
  readStagedShasum,
} from './publish-infra/npm/shared.mts'
import {
  runDirect,
  runStaged,
  verifyStagedEntry,
} from './publish-infra/npm/staged.mts'
import {
  discardReleaseBranch,
  promoteReleaseBranch,
} from './publish-infra/release-branch.mts'
import {
  ensureTagAndRelease,
  extractChangelogSection,
} from './publish-infra/release.mts'
import { logger, rootPath } from './publish-infra/shared.mts'
import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

export {
  ensureTagAndRelease,
  extractChangelogSection,
  isStagingExpected,
  parseStageListJson,
  readStagedShasum,
  resolveBumpScript,
  verifyStagedEntry,
}

/**
 * The nudge printed when a HUMAN runs a real upload from a laptop instead of
 * dispatching the release workflow. The workflow is the auditable path: it
 * runs on a clean checkout, mints a short-lived OIDC token inside the
 * `npm-publish` environment, attaches provenance, and leaves a run record.
 * A local run does none of that and depends on whatever the machine happens
 * to have installed. Returns undefined when no nudge is warranted — in CI
 * (the workflow IS the sanctioned caller), on a dry run, and on `--approve`
 * (promoting a staged upload is deliberately local: it needs the human's
 * 2FA and has no CI equivalent).
 */
export function releaseWorkflowNudge(config: {
  ci: boolean
  dryRun: boolean
  mode: string
}): string | undefined {
  const { ci, dryRun, mode } = config
  if (ci || dryRun || mode === 'approve') {
    return undefined
  }
  return (
    `Running a real ${mode} upload locally. Prefer the release workflow — ` +
    `\`gh workflow run npm-publish.yml\` — which publishes from a clean ` +
    `checkout with OIDC provenance and leaves an audit trail; a laptop run ` +
    `has none of that. Continuing.`
  )
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      approve: { default: false, type: 'boolean' },
      backfill: { type: 'string' },
      bump: { default: false, type: 'boolean' },
      'checkout-ref': { type: 'string' },
      direct: { default: false, type: 'boolean' },
      'dry-run': { default: false, type: 'boolean' },
      otp: { type: 'string' },
      // The parser rewrites `--no-X` into `X: false`, so the negatable flags
      // are declared by their positive names and read the same way.
      reconcile: { default: true, type: 'boolean' },
      release: { default: true, type: 'boolean' },
      'release-as': { type: 'string' },
      scan: { default: true, type: 'boolean' },
      staged: { default: false, type: 'boolean' },
      tag: { default: 'latest', type: 'string' },
      yes: { default: false, type: 'boolean' },
    },
    allowPositionals: false,
    strict: false,
  })

  const modes = [values['staged'], values['approve'], values['direct']].filter(
    Boolean,
  ).length
  if (modes > 1) {
    logger.fail('Pass at most one of --staged / --approve / --direct.')
    process.exitCode = 1
    return
  }
  // Default to staged — the safest publish path (server-side rejectable before
  // anything goes public). A bare `pnpm publish` uploads to staging.
  const mode = values['direct']
    ? 'direct'
    : values['approve']
      ? 'approve'
      : 'staged'

  const dryRun = !!values['dry-run']
  const otpFromFlag =
    typeof values['otp'] === 'string' ? values['otp'] : undefined
  const releaseAs =
    typeof values['release-as'] === 'string' ? values['release-as'] : undefined
  // Reconcile is the DEFAULT once published (local, not a flag — a flag is
  // forgotten and local main drifts from the release). Gated OFF in CI:
  // `--staged` runs on a clean OIDC checkout and must never touch git.
  // `--no-reconcile` is the deliberate local opt-out.
  const reconcile = !getCI() && values['reconcile'] !== false
  const workflowNudge = releaseWorkflowNudge({ ci: getCI(), dryRun, mode })
  if (workflowNudge) {
    logger.warn(workflowNudge)
  }
  const backfillVersion =
    typeof values['backfill'] === 'string' && values['backfill']
      ? values['backfill']
      : undefined
  const checkoutRef =
    typeof values['checkout-ref'] === 'string' && values['checkout-ref']
      ? values['checkout-ref']
      : undefined
  const flagConflict = backfillFlagConflict({
    backfillVersion,
    bump: !!values['bump'],
    checkoutRef,
    mode,
    releaseAs,
  })
  if (flagConflict) {
    logger.fail(flagConflict)
    process.exitCode = 1
    return
  }
  // Backfill: the ONLY sanctioned path to a version below registry latest.
  // The bump/changelog gate is bypassed — the backfill guards replace it —
  // and on a pass the publish continues through the normal staged path with
  // the checked-out content as-is.
  if (backfillVersion) {
    const allowed = await runBackfillGate({
      backfillVersion,
      checkoutRef,
      distTag: String(values['tag']),
    })
    if (!allowed) {
      process.exitCode = 1
      return
    }
  }
  // CI release path: `--staged --bump` bumps + commits, via the release App, on
  // a throwaway release branch before staging, so the publish targets the bumped
  // tree without touching main. `bumpResult` is undefined on a dry-run / no-op
  // bump, nothing to promote.
  const bumpResult = values['bump']
    ? await runBump({ dryRun, releaseAs })
    : undefined
  try {
    if (mode === 'staged') {
      await runStaged(String(values['tag']), { dryRun })
    } else if (mode === 'direct') {
      await runDirect(String(values['tag']), { dryRun })
    } else {
      await runApprove({
        dryRun,
        noScan: values['scan'] === false,
        otpFromFlag,
        skipRelease: values['release'] === false,
        yes: !!values['yes'],
      })
      // Reconcile ONCE PUBLISHED: approve just made the version public and the
      // release App pushed its bump to origin. Rebase our remaining local
      // commits onto that freshly-published base, then ff-pull so local main
      // matches the now-updated origin. Fail-loud on a conflict — never guess a
      // lineage.
      if (reconcile && !dryRun) {
        // The PUBLISH SUBJECT's name — the root for a plain repo, the
        // redirected subject for a publishConfig.directory monorepo, the MAIN
        // package for a multi-package workspace (a private root has no
        // registry history to reconcile against).
        const pkgName = readPackageJson().name
        const published = await fetchPublishedVersion(pkgName)
        const baseSha = await findPublishedBaseSha(rootPath, published)
        await rebaseOntoPublishedBase(rootPath, baseSha)
        await syncFromOriginMain(rootPath)
      }
    }
  } catch (e) {
    // The publish FAILED, before it completed: nuke the release branch so main
    // never sees the bump. Discard only runs here, on a pre-success failure —
    // never for a promote failure below.
    if (bumpResult) {
      await discardReleaseBranch(bumpResult.releaseBranch)
    }
    throw e
  }
  // The publish SUCCEEDED — land the bump on main by fast-forwarding main's ref
  // to the release branch tip with the release App token (never a PR: a bump PR
  // stalls on branch-protection rules the fresh branch cannot satisfy). This is
  // deliberately OUTSIDE the try: if the promote fails, the throw must NOT
  // discard the branch — the version is already published, so the branch stays
  // put to keep the bump commit reachable and the failure is loud.
  if (bumpResult) {
    await promoteReleaseBranch(bumpResult.releaseBranch, bumpResult.sha)
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'publishes this package to npm via staged upload, local approve, or direct modes',
  help: `Usage: pnpm publish [--staged | --approve | --direct] [--dry-run] [--otp <code>] [--yes]

  (no mode → --staged, the default publish path)

  --staged             CI: upload to npm staging via OIDC (recommended)
  --approve            local: multi-select + 2FA promote
  --direct             classic \`pnpm publish\` — public in one step,
                       no stage/approve. Escape hatch when the stage
                       endpoint is unreachable (errors if staging is
                       available — use --staged instead).
  --dry-run            simulate; no registry writes
  --otp <code>         pre-supply 2FA (skips OTP prompt on --approve)
  --yes                approve all staged non-interactively; with no
                       --otp, 2FA runs in the browser (web-OTP)
  --no-scan            skip the pre-approve Socket full-scan gate
  --no-release         with --approve: skip the tag + GitHub release
                       (the publish-pipeline release stage owns them)
  --no-reconcile       local: skip the once-published reconcile (rebase
                       our commits onto the newly-published base + ff-pull
                       origin main). Runs by DEFAULT after --approve
                       (fails loud on conflict); CI --staged never does.
  --tag <tag>          dist-tag for --staged (default: latest)
  --bump               CI: bump version + CHANGELOG, commit via the
                       release App (signed), then run the chosen mode
  --release-as <lvl>   force bump level major|minor|patch (with --bump)
  --backfill <ver>     CI: stage a never-published GAP version of prior
                       content. Bypasses the bump/changelog gate behind
                       hard guards; requires --checkout-ref + a
                       non-latest --tag. See publish-infra/npm/backfill.mts
  --checkout-ref <ref> the content ref a --backfill republishes`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
