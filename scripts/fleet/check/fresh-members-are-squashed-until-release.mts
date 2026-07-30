#!/usr/bin/env node
/*
 * @file Release/CI gate: the `squash-history` opt-in tracks the release
 *   boundary in BOTH directions. A fleet member that has never shipped a
 *   published artifact keeps a collapsible single-commit history, so it carries
 *   `optIns: ["squash-history"]` in the cascade roster; the moment it has a
 *   published release that opt-in must come OFF, because a squash rewrites
 *   every SHA a published artifact's provenance — and anyone who pinned a
 *   commit — points at.
 *
 *   ASYMMETRIC SEVERITY, deliberately. Released-but-still-opted-in FAILS: it is
 *   a live hazard, the next `squashing-history` run rewrites commits consumers
 *   already resolved, and that damage is not reversible. Unreleased-but-not-
 *   opted-in only WARNS: nothing is broken by it, the cost is a missed
 *   opportunity to keep history tidy, and a hard fail would red-light the
 *   window between "roster entry lands" and "the repo has any manifest at all"
 *   — exactly the onboarding minute this rule is meant to help.
 *
 *   RELEASE SIGNALS are npm and crates.io, via
 *   `_shared/member-release-probe.mts`, which the roster writer
 *   (`scripts/repo/register-fleet-member.mts`) shares so the gate and the
 *   default can never disagree. GitHub releases are not a signal: the
 *   wheelhouse itself ships release bundles and squashes by design.
 *
 *   NETWORK DISCIPLINE. Offline-safe, never fails closed on connectivity. No
 *   `gh`, no auth, an API error, an unreadable manifest, or an unreachable
 *   registry all yield UNVERIFIED for that member — reported as a notice, never
 *   a failure and never a silent pass. Registered as a `releaseStep`, so the
 *   interactive `check --all` loop stays offline while CI and the pre-push gate
 *   carry it.
 *
 *   Exit: 0 — no released member is still opted in; 1 — at least one is.
 *   Usage: node scripts/fleet/check/fresh-members-are-squashed-until-release.mts [--quiet]
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  isOptedIn,
  loadRosterFromRepo,
} from '../../../.claude/hooks/fleet/_shared/fleet-roster.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { probeMemberRelease } from '../_shared/member-release-probe.mts'
import { OWNS_RELOCATED_TESTS, REPO_ROOT } from '../paths.mts'

import type {
  FleetRepo,
  FleetRoster,
} from '../../../.claude/hooks/fleet/_shared/fleet-roster.mts'
import type { MemberReleaseState } from '../_shared/member-release-probe.mts'

const logger = getDefaultLogger()

// The roster capability this gate ratchets.
const SQUASH_OPT_IN = 'squash-history'

const DOC_PATH = 'docs/agents.md/fleet/squash-until-release.md'

export type SquashWindowFindingKind =
  | 'released-but-opted-in'
  | 'unreleased-and-not-opted-in'

/**
 * One member's disagreement between its roster opt-in and its release state.
 */
export interface SquashWindowFinding {
  readonly artifact?: string | undefined
  readonly kind: SquashWindowFindingKind
  readonly member: string
  readonly registry?: string | undefined
  readonly version?: string | undefined
}

/**
 * The whole bidirectional rule in one pure function: an opt-in belongs to an
 * unreleased member and to no other. An `unverified` release state produces no
 * finding at all — the probe could not read the member, so neither direction
 * can be asserted about it.
 */
export function judgeSquashWindow(
  roster: FleetRoster,
  member: string,
  state: MemberReleaseState,
): SquashWindowFinding | undefined {
  if (state.verdict === 'unverified') {
    return undefined
  }
  const optedIn = isOptedIn(roster, member, SQUASH_OPT_IN)
  if (state.verdict === 'released') {
    return optedIn
      ? {
          artifact: state.artifact,
          kind: 'released-but-opted-in',
          member,
          registry: state.registry,
          version: state.version,
        }
      : undefined
  }
  return optedIn ? undefined : { kind: 'unreleased-and-not-opted-in', member }
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
    if (finding.kind === 'released-but-opted-in') {
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

// The one-line evidence for a hazard, naming the package, the registry, and the
// published version.
function hazardEvidence(finding: SquashWindowFinding): string {
  const artifact = finding.artifact ?? finding.member
  const registry = finding.registry ?? 'a registry'
  const version = finding.version ?? 'an unknown version'
  return `  ${finding.member}: \`${artifact}\` is published on ${registry} at ${version}.`
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
    `fresh-members-are-squashed-until-release: ${hazards.length} released member(s) still opted into \`${SQUASH_OPT_IN}\`:`,
  )
  for (let i = 0, { length } = hazards; i < length; i += 1) {
    logger.fail(hazardEvidence(hazards[i]!))
  }
  logger.fail(
    `  What:  a member with a published release still carries the \`${SQUASH_OPT_IN}\` opt-in.\n` +
      '  Where: the member(s) above, in the cascade roster\n' +
      '         .claude/skills/fleet/cascading-fleet/lib/fleet-repos.json.\n' +
      '  Wanted: the opt-in belongs to members that have NEVER released. A squash\n' +
      "          rewrites every commit the published artifact's provenance and any\n" +
      '          SHA-pinning consumer resolve, and those commits must keep existing.\n' +
      `  Fix:   remove "${SQUASH_OPT_IN}" from that member's \`optIns\` in\n` +
      '         template/base/.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json,\n' +
      '         then cascade it to the live mirror:\n' +
      '           node scripts/repo/sync-scaffolding/cli.mts --target . --fix\n' +
      `         See ${DOC_PATH}.`,
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(
      `fresh-members-are-squashed-until-release failed: ${errorMessage(e)}`,
    )
    process.exitCode = 1
  })
}
/* c8 ignore stop */
