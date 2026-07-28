/**
 * @file `--approve` mode: list the user's staged packages, run the
 *   pre-approve integrity gate over every eligible entry FIRST (staging is
 *   one-shot per version, so verification must complete successfully before
 *   the human approve step is even offered), then multi-select over the
 *   verified entries, then batch-approve with one shared 2FA OTP and create
 *   the git tag + GitHub release for each promoted package. `--yes` replaces
 *   both interactive prompts for agent/scripted runs: every verified entry is
 *   selected, and with no `--otp` the registry challenge drives pnpm's
 *   web-OTP (a browser window to npmjs.com opens per approve call, so the
 *   human authenticates in the browser instead of the terminal).
 */

import process from 'node:process'

import { checkbox, password } from '@socketsecurity/lib-stable/stdio/prompts'

import {
  APPROVE_IS_NOT_A_RESUME_PATH,
  releaseGapRecoveryCommand,
} from '../../_shared/release-gap-recovery.mts'
import { releaseBehindLiveGate } from '../release.mts'
import { logger, rootPath, runInheritTty } from '../shared.mts'
import { isAlreadyPublished } from './registry.mts'
import type { StageListEntry } from './shared.mts'
import {
  fetchPriorProvenanceMap,
  formatPriorProvenance,
  listStagedPackages,
  readPackageJson,
} from './shared.mts'
import { ensureNpmIdentity } from './auth-identity.mts'
import { scanStagedEntry } from './scan.mts'
import { defaultDownloadStagedTarball, verifyStagedEntry } from './staged.mts'
import {
  packWorkspaceReleaseAssets,
  verifyStagedPlatformEntry,
} from './staged-workspace.mts'
import { hasMachineBuiltPayload } from './workspace-plan.mts'
import {
  findWorkspacePackageByName,
  resolveNpmWorkspaceLayout,
} from './workspace.mts'

export interface ApproveChoice {
  checked: boolean
  name: string
  value: string
}

/**
 * Build the checkbox choices for the approve multi-select: one row per eligible
 * staged entry, labelled `name@version` with the prior-provenance annotation,
 * valued by its stageId, pre-checked so the default is "approve all". Pure over
 * the eligible list + the prior-provenance map.
 */
export function buildApproveChoices(
  eligible: readonly StageListEntry[],
  priorProvenance: ReadonlyMap<string, boolean>,
): ApproveChoice[] {
  return eligible.map(e => ({
    checked: true,
    name: `${e.name}@${e.version}${formatPriorProvenance(priorProvenance.get(e.name!))}`,
    value: e.stageId!,
  }))
}

/**
 * `--approve` mode: list the user's staged packages, multi-select, batch
 * approve with one OTP.
 *
 * Filters out any staged entries whose name@version is already public (e.g. a
 * re-stage after a partial approve). Empty selection is a no-op. The OTP is
 * read via a hidden-character prompt; a single OTP value is reused across all
 * approve calls in the same batch — npm accepts the same TOTP within its ~30s
 * validity window. With `yes` both prompts are skipped: all eligible entries
 * are selected, and (absent `otpFromFlag`) 2FA falls through to the browser
 * web-OTP challenge.
 */
export async function runApprove(config: {
  dryRun: boolean
  noScan: boolean
  otpFromFlag: string | undefined
  skipRelease?: boolean | undefined
  yes: boolean
}): Promise<void> {
  const { dryRun, noScan, otpFromFlag, skipRelease, yes } = {
    __proto__: null,
    ...config,
  } as typeof config
  // Identity, not just auth: staged entries are maintainer-visible, so a
  // wrong-account login reads an empty stage list and the approve silently
  // no-ops. ensureNpmIdentity covers logged-out (delegates to login.mts) AND
  // wrong-user (TTY: consented logout/login rotation; otherwise fail loud).
  const layout = resolveNpmWorkspaceLayout(rootPath)
  if (!(await ensureNpmIdentity(layout.versionSource.name))) {
    process.exitCode = 1
    return
  }
  const staged = await listStagedPackages()
  if (staged.length === 0) {
    logger.log('No packages currently staged.')
    return
  }

  // The stage list is ACCOUNT-scoped, not repo-scoped: entries staged by this
  // account from OTHER repos show up here too. Approve must skip those — the
  // verify gate can only ever pack THIS repo's packages (defaultPackTarball
  // packs this checkout), so a foreign entry could never verify; worse, its
  // verify pack would pin THIS repo's README against the FOREIGN entry's
  // version (a wrong-manifest pin) and then fail with advice to reject an
  // artifact that is perfectly good in its own repo. "Ours" is the full
  // publishable-name set: the single subject for a plain repo, every
  // workspace member (loader + platform packages) for a multi layout.
  const localNames =
    layout.kind === 'multi'
      ? new Set(layout.packages.map(pkg => pkg.name))
      : new Set([readPackageJson().name])
  const localLabel = [...localNames].toSorted().join(', ')
  const ours: StageListEntry[] = []
  for (const entry of staged) {
    if (entry.name && localNames.has(entry.name)) {
      ours.push(entry)
    } else {
      logger.log(
        `Skipping ${entry.name}@${entry.version} — staged by this account but ` +
          `not this repo's package (${localLabel}). Run --approve from its own repo.`,
      )
    }
  }
  if (ours.length === 0) {
    logger.log(`No staged entries for ${localLabel}; nothing to approve here.`)
    return
  }

  // Filter out already-published versions. If a stage upload was
  // approved earlier but the entry lingers in stage list (registry
  // quirk), don't offer it for re-approval.
  const eligible: StageListEntry[] = []
  for (let i = 0, { length } = ours; i < length; i += 1) {
    const entry = ours[i]!
    // eslint-disable-next-line no-await-in-loop
    if (
      entry.name &&
      entry.version &&
      !(await isAlreadyPublished(entry.name, entry.version))
    ) {
      eligible.push(entry)
    }
  }
  if (eligible.length === 0) {
    // This filter runs BEFORE the tag + GitHub release leg, so an operator who
    // re-runs --approve to heal a missing tag lands here and exits zero having
    // cut nothing. Name the real resume path rather than let the no-op read as
    // "already done".
    logger.log('All staged entries are already published; nothing to approve.')
    logger.log(
      `  ${APPROVE_IS_NOT_A_RESUME_PATH}\n` +
        `  If a published version is missing its tag or GitHub release, heal it with\n` +
        `  ${releaseGapRecoveryCommand('<version>')}`,
    )
    return
  }

  // Pre-approve integrity gate FIRST — before the human is offered anything.
  // Staging is one-shot per version (a staged-then-published version can
  // never re-stage), so verification must complete successfully BEFORE the
  // approve step is offered: a divergent or unverifiable artifact never
  // reaches the multi-select, the 2FA prompt, or `pnpm stage approve`.
  // Generated PLATFORM packages verify structurally on the staged bytes
  // (their CI-built payload has no local twin to byte-compare — see
  // verifyStagedPlatformEntry); everything else keeps the local-pack
  // byte-compare gate.
  const verifiedEntries: StageListEntry[] = []
  for (let i = 0, { length } = eligible; i < length; i += 1) {
    const entry = eligible[i]!
    const member = entry.name
      ? findWorkspacePackageByName(layout, entry.name)
      : undefined
    // eslint-disable-next-line no-await-in-loop
    const verified =
      member && (member.platform || hasMachineBuiltPayload(member.manifest))
        ? await verifyStagedPlatformEntry(entry, member, {
            downloadStagedTarball: defaultDownloadStagedTarball,
          })
        : await verifyStagedEntry(entry)
    if (verified) {
      verifiedEntries.push(entry)
    }
  }
  if (verifiedEntries.length === 0) {
    logger.fail(
      'No staged package passed pre-approve verification; nothing offered for approve.',
    )
    process.exitCode = 1
    return
  }
  if (verifiedEntries.length < eligible.length) {
    logger.fail(
      `${eligible.length - verifiedEntries.length}/${eligible.length} failed pre-approve verify; ` +
        `offering only the ${verifiedEntries.length} verified. Reject the rest (pnpm stage reject <id>).`,
    )
    process.exitCode = 1
  }

  // Fetch prior-version provenance for each unique package name so the
  // approver can spot regressions (last public version had provenance
  // but the staged one's parent name has lost trust metadata between
  // versions — a workflow drift signal). Cheap: one fetch per unique
  // name, abbreviated packument (no _npmUser needed; we only check
  // attestations presence as a proxy for "this name is OIDC-published").
  const priorProvenance = await fetchPriorProvenanceMap(verifiedEntries)

  const choices = buildApproveChoices(verifiedEntries, priorProvenance)
  let selected: string[] | undefined
  if (yes) {
    // --yes (agent / scripted runs, no TTY): approve everything eligible —
    // the same set the interactive default offers (every row pre-checked).
    // The rows still print so the prior-provenance annotations stay visible.
    logger.log('--yes: approving all staged packages:')
    for (const choice of choices) {
      logger.log(`  ${choice.name}`)
    }
    selected = choices.map(c => c.value)
  } else {
    selected = (await checkbox({
      message: 'Select staged packages to approve:',
      choices,
    })) as string[] | undefined
  }
  if (!selected || selected.length === 0) {
    logger.log('Nothing selected; exiting.')
    return
  }

  if (dryRun) {
    logger.log('[dry-run] would approve:')
    for (const stageId of selected) {
      const entry = verifiedEntries.find(e => e.stageId === stageId)
      logger.log(`  ${entry?.name}@${entry?.version} (id: ${stageId})`)
    }
    logger.success(
      `Dry-run complete. Re-run without --dry-run to prompt for OTP and promote.`,
    )
    return
  }

  // Full-scan gate: the pre-select shasum verify proved the staged bytes
  // match the local pack, so a Socket scan of the local artifact IS a scan of
  // the upload. Entries that fail drop out, mirroring the verify gate. Runs
  // BEFORE the OTP prompt: a TOTP code is only valid ~30s, so every slow gate
  // must finish before the human types one.
  let gated = selected
  if (noScan) {
    logger.log('--no-scan: skipping the Socket full-scan gate.')
  } else {
    const scanned: string[] = []
    for (let i = 0, { length } = selected; i < length; i += 1) {
      const stageId = selected[i]!
      const entry = verifiedEntries.find(e => e.stageId === stageId)
      if (!entry?.name || !entry.version) {
        continue
      }
      // Platform packages scan the DOWNLOADED staged tarball — the artifact
      // the structural verify gate just checked — since a local pack cannot
      // reproduce their CI-built payload.
      const member = findWorkspacePackageByName(layout, entry.name)
      const scanSubject = { name: entry.name, version: entry.version }
      // eslint-disable-next-line no-await-in-loop
      const scanOk =
        member && (member.platform || hasMachineBuiltPayload(member.manifest))
          ? await scanStagedEntry(scanSubject, {
              packTarball: () => defaultDownloadStagedTarball(stageId),
            })
          : await scanStagedEntry(scanSubject)
      if (scanOk) {
        scanned.push(stageId)
      }
    }
    if (scanned.length === 0) {
      logger.fail(
        'No selected package passed the Socket scan gate; nothing approved.',
      )
      process.exitCode = 1
      return
    }
    if (scanned.length < selected.length) {
      logger.fail(
        `${selected.length - scanned.length}/${selected.length} failed the scan gate; ` +
          `approving only the ${scanned.length} that scanned clean.`,
      )
      process.exitCode = 1
    }
    gated = scanned
  }

  // OTP resolution order:
  //   1. --otp <code> flag (CI / scripted use).
  //   2. --yes with no --otp: skip the prompt entirely and let the registry
  //      challenge drive pnpm's web-OTP (browser) flow directly.
  //   3. Interactive prompt; entering a TOTP code uses it for all
  //      approvals; entering nothing falls through to pnpm's per-call
  //      web-OTP flow (the registry challenges and pnpm opens a browser
  //      window to npmjs.com for each approve call).
  // Passing the same TOTP to every approve in a batch is fine: npm
  // accepts the same code for the duration of its ~30s validity window —
  // which is exactly why this prompt sits LAST, after every gate.
  let otp = otpFromFlag
  if (!otp && yes) {
    logger.log(
      'No --otp supplied; npm opens a browser window (web-OTP) to authenticate each approve — complete the 2FA there.',
    )
  } else if (!otp) {
    const entered = (await password({
      message:
        '2FA OTP (TOTP code for batch; leave blank for browser web-OTP):',
      mask: '*',
    })) as string | undefined
    if (entered) {
      otp = entered
    }
  }

  let approved = 0
  let failed = 0
  const approvedEntries: StageListEntry[] = []
  for (let i = 0, { length } = gated; i < length; i += 1) {
    const stageId = gated[i]!
    const args = ['stage', 'approve', stageId]
    if (otp) {
      args.push('--otp', otp)
    }
    // TTY-wrapped: the registry's web-OTP challenge (no --otp) refuses
    // non-interactive stdio instead of opening the browser.
    // eslint-disable-next-line no-await-in-loop
    const code = await runInheritTty('pnpm', args, rootPath)
    if (code === 0) {
      approved += 1
      const entry = verifiedEntries.find(e => e.stageId === stageId)
      if (entry) {
        approvedEntries.push(entry)
      }
    } else {
      failed += 1
      logger.fail(`Approve ${stageId} exited ${code}`)
    }
  }
  if (failed > 0) {
    logger.fail(`${failed}/${gated.length} failed; ${approved} approved`)
    process.exitCode = 1
    return
  }
  logger.success(`Approved ${approved} package${approved === 1 ? '' : 's'}`)

  // Approve is the moment a staged package becomes public, so the git tag +
  // GitHub release are created here rather than at --staged time. This runs
  // locally where git, gh, and npm are all authenticated; the CI --staged step
  // holds only an OIDC npm token (no contents:write / GH_TOKEN), so a release
  // attempt there fails and is also premature (nothing is public yet).
  // `skipRelease` (--no-release) hands the tag + release to the caller — the
  // publish pipeline's release stage owns them there, with verify-time
  // checksums.
  if (skipRelease) {
    logger.log(
      '--no-release: leaving the tag + GitHub release to the caller ' +
        '(publish-pipeline release stage).',
    )
    return
  }
  // Multi-package layout: every member shares one lockstep version, so ONE
  // tag + immutable release covers the whole approved set — keyed on the
  // MAIN package's liveness, with every member tarball (+ checksums) as
  // assets. Per-entry releases would fight over the same v<version> tag.
  if (layout.kind === 'multi' && approvedEntries.length > 0) {
    const main = layout.main!
    const version = layout.versionSource.version
    const released = await releaseBehindLiveGate({
      isLive: () => isAlreadyPublished(main.name, version),
      packAssets: () => packWorkspaceReleaseAssets(layout),
      pkg: { name: main.name, version },
      registry: 'npm',
    })
    if (!released) {
      process.exitCode = 1
    }
    return
  }
  for (let i = 0, { length } = approvedEntries; i < length; i += 1) {
    const entry = approvedEntries[i]!
    if (entry.name && entry.version) {
      // The tag + immutable release are the LAST markers: cut them only once
      // the approved version is actually resolvable on the registry.
      // eslint-disable-next-line no-await-in-loop
      const released = await releaseBehindLiveGate({
        isLive: () => isAlreadyPublished(entry.name!, entry.version!),
        pkg: { name: entry.name, version: entry.version },
        registry: 'npm',
      })
      if (!released) {
        process.exitCode = 1
      }
    }
  }
}
