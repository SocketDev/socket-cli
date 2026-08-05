#!/usr/bin/env node
/*
 * @file Release/CI gate: the `squash-history` opt-in FREEZES at a member's
 *   first published release rather than coming off. A fleet member that has
 *   never shipped a published artifact keeps a fully collapsible
 *   single-commit history, so it carries `optIns: ["squash-history"]` in the
 *   cascade roster; the first published release does NOT drop the opt-in —
 *   `squashing-history` now collapses only the TAIL above the newest
 *   published-release commit (the freeze boundary), so the opt-in stays
 *   meaningful for a released member too.
 *
 *   ASYMMETRIC SEVERITY, deliberately. A released, opted-in member whose
 *   frozen-zone anchor is NOT reachable from its default branch FAILS: that
 *   shape means the release commit got orphaned anyway (a full-root squash
 *   ran despite the freeze boundary, or the boundary itself was later
 *   rewritten) — a live hazard, not reversible by re-pushing. An unreleased
 *   member that never opted in only WARNS: nothing is broken by it, the cost
 *   is a missed opportunity to keep history tidy, and a hard fail would
 *   red-light the window between "roster entry lands" and "the repo has any
 *   manifest at all" — exactly the onboarding minute this rule is meant to
 *   help.
 *
 *   RELEASE SIGNALS are npm and crates.io, via
 *   `_shared/member-release-probe.mts`, which the roster writer
 *   (`scripts/repo/register-fleet-member.mts`) shares so the gate and the
 *   default can never disagree. GitHub releases are not a signal: the
 *   wheelhouse itself ships release bundles and squashes by design.
 *
 *   NETWORK DISCIPLINE. Offline-safe, never fails closed on connectivity. No
 *   `gh`, no auth, an API error, an unreadable manifest, an unreachable
 *   registry, or an unresolved release anchor all yield UNVERIFIED for that
 *   member — reported as a notice, never a failure and never a silent pass.
 *   The frozen-zone reachability check needs a registry read (for the anchor)
 *   AND a GitHub compare-API read (for ancestry); either failing alone still
 *   yields UNVERIFIED, never a false hazard. Registered as a `releaseStep`, so
 *   the interactive `check --all` loop stays offline while CI and the
 *   pre-push gate carry it.
 *
 *   Exit: 0 — no released+opted-in member's frozen zone is orphaned; 1 — at
 *   least one is.
 *   Usage: node scripts/fleet/check/fresh-members-are-squashed-until-release.mts [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  isOptedIn,
  loadRosterFromRepo,
} from '../../../.claude/hooks/fleet/_shared/fleet-roster.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import {
  probeMemberRelease,
  verifyFrozenZoneReachable,
} from '../_shared/member-release-probe.mts'
import { runMain } from '../_shared/run-main.mts'
import { OWNS_RELOCATED_TESTS, REPO_ROOT } from '../paths.mts'

import type {
  FleetRepo,
  FleetRoster,
} from '../../../.claude/hooks/fleet/_shared/fleet-roster.mts'
import type { MemberReleaseState } from '../_shared/member-release-probe.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The roster capability this gate ratchets.
const SQUASH_OPT_IN = 'squash-history'

const DOC_PATH = 'docs/agents.md/fleet/squash-until-release.md'

export type SquashWindowFindingKind =
  | 'frozen-zone-orphaned'
  | 'unreleased-and-not-opted-in'

/**
 * One member's squash-window hazard or opportunity. `frozen-zone-orphaned`
 * carries the anchor sha whose reachability failed; `unreleased-and-not-
 * opted-in` carries neither. An unreleased member has no anchor at all.
 */
export interface SquashWindowFinding {
  readonly anchorSha?: string | undefined
  readonly artifact?: string | undefined
  readonly kind: SquashWindowFindingKind
  readonly member: string
  readonly registry?: string | undefined
  readonly version?: string | undefined
}

/**
 * The unreleased-member half of the rule: an opt-in belongs to an unreleased
 * member. A `released` or `unverified` state produces no finding here — the
 * released direction is judged separately by `judgeFrozenZoneReachability`,
 * which needs an async network probe this pure function does not make.
 */
export function judgeSquashWindow(
  roster: FleetRoster,
  member: string,
  state: MemberReleaseState,
): SquashWindowFinding | undefined {
  if (state.verdict !== 'unreleased') {
    return undefined
  }
  const optedIn = isOptedIn(roster, member, SQUASH_OPT_IN)
  return optedIn ? undefined : { kind: 'unreleased-and-not-opted-in', member }
}

/**
 * The released-member half of the rule: a released, opted-in member's frozen
 * zone must stay reachable. `reachability` is the async
 * `verifyFrozenZoneReachable` result — `unverified` (the network read
 * couldn't confirm either way) produces no finding, matching the offline-safe
 * contract; only a confirmed `orphaned` anchor is a finding.
 */
export function judgeFrozenZoneReachability(
  member: string,
  state: MemberReleaseState,
  reachability: 'orphaned' | 'reachable' | 'unverified',
): SquashWindowFinding | undefined {
  if (reachability !== 'orphaned') {
    return undefined
  }
  return {
    anchorSha: state.anchorSha,
    artifact: state.artifact,
    kind: 'frozen-zone-orphaned',
    member,
    registry: state.registry,
    version: state.version,
  }
}

/**
 * Split findings by direction, so the caller can fail on one and warn on the
 * other without re-testing the kind at every use.
 */
export function partitionSquashFindings(
  findings: readonly SquashWindowFinding[],
): {
  hazards: SquashWindowFinding[]
  opportunities: SquashWindowFinding[]
} {
  const hazards: SquashWindowFinding[] = []
  const opportunities: SquashWindowFinding[] = []
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    if (finding.kind === 'frozen-zone-orphaned') {
      hazards.push(finding)
    } else {
      opportunities.push(finding)
    }
  }
  return { hazards, opportunities }
}

// True when `gh` is installed and authenticated — the precondition for reading
// a member's manifests. Anything else means UNVERIFIED for every member.
async function ghAuthed(): Promise<boolean> {
  try {
    await spawn('gh', ['auth', 'status'], { stdio: 'pipe', stdioString: true })
    return true
  } catch {
    return false
  }
}

// The one-line evidence for a hazard, naming the package, the registry, the
// published version, and the anchor sha that no longer resolves onto the
// member's default branch.
function hazardEvidence(finding: SquashWindowFinding): string {
  const artifact = finding.artifact ?? finding.member
  const registry = finding.registry ?? 'a registry'
  const version = finding.version ?? 'an unknown version'
  const anchor = finding.anchorSha ?? '(unknown anchor)'
  return (
    `  ${finding.member}: \`${artifact}\` published on ${registry} at ` +
    `${version} — release anchor ${anchor} is NOT reachable from the ` +
    'default branch.'
  )
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  // Release/CI tier only — a fleet-wide network sweep, never the interactive
  // inner loop. check.mts sets FLEET_CHECK_RELEASE under --release / CI.
  if (!process.env['FLEET_CHECK_RELEASE']) {
    return
  }
  // Wheelhouse-only. The roster cascades fleet-wide for the hook membership
  // law, so every member carries it; without this gate every member's release
  // CI would re-run the same fleet-wide sweep.
  if (!OWNS_RELOCATED_TESTS) {
    return
  }
  const roster = loadRosterFromRepo(REPO_ROOT)
  if (!roster) {
    logger.warn(
      'fresh-members-are-squashed-until-release: SKIPPED — no cascade roster resolved.\n' +
        `  No member's squash window was checked this run.`,
    )
    return
  }
  if (!(await ghAuthed())) {
    logger.warn(
      'fresh-members-are-squashed-until-release: SKIPPED — `gh` is unavailable or unauthenticated.\n' +
        "  Member manifests were NOT read, so no member's squash window was checked.\n" +
        '  Fix: run `gh auth login` to restore the read.',
    )
    return
  }
  const findings: SquashWindowFinding[] = []
  const unverified: Array<{ member: string; reason: string }> = []
  const { repos } = roster
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const repo: FleetRepo = repos[i]!
    const state = await probeMemberRelease(repo)
    if (state.verdict === 'unverified') {
      unverified.push({
        member: repo.name,
        reason: state.reason ?? 'no evidence',
      })
      continue
    }
    if (state.verdict === 'released') {
      // Only a released, OPTED-IN member has a frozen zone that matters here
      // — an opted-out released member carries ordinary history and has
      // nothing this gate can orphan.
      if (!isOptedIn(roster, repo.name, SQUASH_OPT_IN)) {
        continue
      }
      if (state.anchorSha === undefined) {
        unverified.push({
          member: repo.name,
          reason:
            'no release anchor could be resolved (missing npm gitHead / ' +
            'crates.io .cargo_vcs_info.json), so its frozen zone could not ' +
            'be checked',
        })
        continue
      }
      const reachability = await verifyFrozenZoneReachable(
        repo,
        state.anchorSha,
      )
      if (reachability === 'unverified') {
        unverified.push({
          member: repo.name,
          reason:
            'the frozen-zone reachability read (default branch / compare ' +
            'API) could not be completed',
        })
        continue
      }
      const finding = judgeFrozenZoneReachability(
        repo.name,
        state,
        reachability,
      )
      if (finding) {
        findings.push(finding)
      }
      continue
    }
    const finding = judgeSquashWindow(roster, repo.name, state)
    if (finding) {
      findings.push(finding)
    }
  }
  for (let i = 0, { length } = unverified; i < length; i += 1) {
    const entry = unverified[i]!
    logger.warn(
      `fresh-members-are-squashed-until-release: UNVERIFIED ${entry.member} — ${entry.reason}.`,
    )
  }
  const { hazards, opportunities } = partitionSquashFindings(findings)
  for (let i = 0, { length } = opportunities; i < length; i += 1) {
    const finding = opportunities[i]!
    logger.warn(
      `fresh-members-are-squashed-until-release: NOTICE ${finding.member} has no published npm or crates.io artifact and is not opted into \`${SQUASH_OPT_IN}\`.\n` +
        `  Fix: add "${SQUASH_OPT_IN}" to its \`optIns\` in the cascade roster while its history is still collapsible.\n` +
        `  See ${DOC_PATH}.`,
    )
  }
  if (hazards.length === 0) {
    if (!quiet) {
      const checked = repos.length - unverified.length
      logger.log(
        `fresh-members-are-squashed-until-release: ${checked} member(s) confirmed against npm + crates.io.`,
      )
    }
    return
  }
  logger.fail(
    `fresh-members-are-squashed-until-release: ${hazards.length} released member(s) have an ORPHANED frozen release:`,
  )
  for (let i = 0, { length } = hazards; i < length; i += 1) {
    logger.fail(hazardEvidence(hazards[i]!))
  }
  logger.fail(
    "  What:  a released, squash-opted member's frozen release anchor is " +
      'not reachable from its default branch.\n' +
      '  Where: the member(s) above.\n' +
      '  Wanted: squashing-history freezes every commit through the newest ' +
      'published release — its SHA (and anything pinning it) must keep ' +
      'resolving.\n' +
      "  Saw: the anchor above is off the default branch's lineage — a " +
      'full-root squash ran anyway, or the boundary itself was later ' +
      'rewritten (the socket-mcp shape, history-rewrites.md).\n' +
      "  Fix:   re-anchor the branch onto the release commit's lineage " +
      '(recovery steps: history-rewrites.md "A rewrite base must sit on ' +
      'origin\'s lineage"), or if the release itself is truly gone, treat ' +
      `it as an incident, not a routine fix. See ${DOC_PATH}.`,
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'verifies released squash-history members keep their frozen release anchor reachable',
  help: `Usage: node scripts/fleet/check/fresh-members-are-squashed-until-release.mts [flags]

  --quiet  suppress the success message`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
