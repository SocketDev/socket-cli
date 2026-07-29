#!/usr/bin/env node
// Claude Code PreToolUse hook — no-private-repo-leak-guard.
//
// BLOCKS a `gh` command whose outbound prose (PR/issue/review/commit-comment
// bodies, titles, release notes, `gh api` REST fields, and GraphQL query
// strings) names a PRIVATE repository while the write target is a public (or
// unverifiable) repo. This is the enforcement twin of `private-name-nudge`:
// the nudge primes attention and never blocks; this guard refuses the call.
// (Incident: a review reply on a public PR walked through a private repo's
// internal file paths and queue config — the nudge fired and was sailed past.)
//
// Detection is roster-driven, never a committed denylist — a checked-in list
// of private repo names would itself be the leak this guard exists to stop.
// The moving parts live beside this file:
//   • `outbound-prose.mts` — what text the command would publish, and which
//     repo it writes to.
//   • `roster.mts` — which repo names under an owner are private, resolved at
//     runtime from `gh repo list` and cached under `~/.socket/_state/`.
//   • `leak-scan.mts` — the match itself: qualified `owner/repo` references
//     and discriminative bare names.
//
// Posting TO a private repo is exempt: mentioning private repos on a private
// surface is internal conversation, not a leak. Everything else fails CLOSED —
// an unresolvable write target is treated as public, and an unavailable
// roster blocks rather than guessing.
//
// Fix: drop the private reference entirely — describe the fact without naming
//      the repo or its internal paths ("checked server-side", "our shared
//      template"). Do not substitute a placeholder that hints at the name.
//
// Bypass: `Allow private-leak bypass`.

import { originOwnerRepo } from '../_shared/fleet-repos.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import { readCommand } from '../_shared/payload.mts'
import { commandsFor, commandWorkingDir } from '../_shared/shell-command.mts'
import { scanProseForPrivateRepos } from './leak-scan.mts'
import {
  collectOutboundProse,
  ghWriteTarget,
  readProseFile,
  splitOwnerRepo,
} from './outbound-prose.mts'
import { createRepoRosterResolver } from './roster.mts'

import type { GuardBlock } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import type { LeakFinding } from './leak-scan.mts'
import type { ProseFileReader } from './outbound-prose.mts'
import type { RepoRoster, RosterResolver } from './roster.mts'

// Dispatcher pre-flight: only `gh` invocations can post to GitHub surfaces.
export const triggers: readonly string[] = ['gh']

export interface LeakCheckDeps {
  readonly originOwner?: string | undefined
  readonly readFile?: ProseFileReader | undefined
  readonly resolveRoster?: RosterResolver | undefined
}

export interface LeakVerdict {
  readonly findings: LeakFinding[]
  readonly rosterFailures: string[]
  readonly targets: string[]
}

/**
 * Pure core: evaluate one Bash command string. Returns undefined when the
 * command publishes no prose or every leak check passes; otherwise the
 * verdict the caller turns into a block message. Dependencies are injectable
 * so tests never reach `gh` or the filesystem.
 */
export function evaluateLeaks(
  command: string,
  cwd: string,
  deps?: LeakCheckDeps | undefined,
): LeakVerdict | undefined {
  const opts = { __proto__: null, ...deps } as LeakCheckDeps
  const readFile: ProseFileReader =
    opts.readFile ?? (filePath => readProseFile(filePath, cwd))
  const resolveRoster = opts.resolveRoster ?? createRepoRosterResolver()

  const findings: LeakFinding[] = []
  const rosterFailures: string[] = []
  const targets: string[] = []
  let sawProse = false

  for (const segment of commandsFor(command, 'gh')) {
    const sources = collectOutboundProse(segment, readFile)
    if (sources.length === 0) {
      continue
    }
    sawProse = true

    const target = ghWriteTarget(segment)

    // A write to a verified-private repo is internal conversation. Checked
    // before the target joins the reported list so an exempt private surface
    // is never named as the `Where:` of a block another segment caused.
    const targetParts = target ? splitOwnerRepo(target) : undefined
    if (targetParts) {
      const lookup = resolveRoster(targetParts.owner)
      if (
        lookup.ok &&
        lookup.roster.privateNames.has(targetParts.repo.toLowerCase())
      ) {
        continue
      }
    }
    if (target) {
      targets.push(target.toLowerCase())
    }

    const owners = new Set<string>()
    if (targetParts) {
      owners.add(targetParts.owner.toLowerCase())
    }
    if (opts.originOwner) {
      owners.add(opts.originOwner.toLowerCase())
    }

    const rosters: RepoRoster[] = []
    for (const owner of owners) {
      const lookup = resolveRoster(owner)
      if (lookup.ok) {
        rosters.push(lookup.roster)
      } else {
        rosterFailures.push(`${lookup.owner}: ${lookup.reason}`)
      }
    }

    for (const source of sources) {
      findings.push(
        ...scanProseForPrivateRepos(source.text, source.label, rosters),
      )
    }
  }

  if (!sawProse) {
    return undefined
  }
  if (findings.length === 0 && rosterFailures.length === 0) {
    return undefined
  }
  return { findings, rosterFailures, targets }
}

function formatBlockMessage(verdict: LeakVerdict): string {
  const saw = [
    ...verdict.findings.map(
      f =>
        `${f.tier === 'qualified' ? 'qualified reference' : 'private repo name'} \`${f.reference}\` (in ${f.source})`,
    ),
    ...verdict.rosterFailures.map(reason => `roster unavailable — ${reason}`),
  ].join('\n         ')
  const fix =
    verdict.findings.length > 0
      ? '  Fix:   remove the private reference entirely. Describe the fact without\n         naming the repo or its internal paths ("checked server-side",\n         "our shared template"). Do not substitute a hinting placeholder.'
      : '  Fix:   the guard could not load the repo roster to verify the text, so\n         it fails closed. Check `gh auth status` / network, then retry.'
  return [
    '🚨 no-private-repo-leak-guard: blocked a `gh` command whose outbound',
    '   text references PRIVATE repositories on a public (or unverified)',
    '   surface.',
    '',
    '  What:  outbound PR/issue/comment/review text',
    `  Where: write target ${
      verdict.targets.length
        ? verdict.targets.join(', ')
        : '(unresolved — treated as public)'
    }`,
    `  Saw:   ${saw}`,
    fix,
    '',
  ].join('\n')
}

export const check = (payload: ToolCallPayload): GuardBlock | undefined => {
  if (payload?.tool_name !== 'Bash') {
    return undefined
  }
  const command = readCommand(payload)
  if (!command) {
    return undefined
  }
  // The directory the `gh` call actually runs in — the fleet's cross-repo
  // pattern is `cd <abs-path> && gh …`, and the origin owner of the WRONG
  // checkout would consult the wrong roster.
  const cwd = commandWorkingDir(command)
  const originOwner = originOwnerRepo(cwd)?.split('/')[0]
  const verdict = evaluateLeaks(command, cwd, { originOwner })
  if (!verdict) {
    return undefined
  }
  return block(formatBlockMessage(verdict))
}

// Auto-bypass: `defineHook` wraps the check so a typed grant lifts the block
// and an unbypassed block gains the exact phrase footer. The `bypass` keyword
// stays REQUIRED (no `bypassOptional`) — this is a disclosure guard, and a
// bare `Allow private-leak` in casual prose must not disarm it.
export const hook = defineHook({
  bypass: ['private-leak'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
