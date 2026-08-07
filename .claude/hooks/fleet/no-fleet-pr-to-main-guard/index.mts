#!/usr/bin/env node
// Claude Code PreToolUse hook — no-fleet-pr-to-main-guard.
//
// Blocks `gh pr create` in a FLEET repo when the PR targets the repo's
// default branch and the current gh viewer is an ADMIN there. The fleet
// lands work by pushing the default branch directly; a PR is the fallback
// for a contributor without push rights, never the admin path. The nudge
// sibling (pr-vs-push-default-nudge) reminds; this guard refuses - the
// reminder alone still let a fleet PR open, go stale behind a directory
// move on main, and need a hand-resolved conflict landing.
//
// What it DENIES:
//   - gh pr create in a fleet repo whose base is the default branch while
//     the gh viewer's permission on the target repo is ADMIN
//
// What it ALLOWS (never over-block):
//   - non-fleet repos - a PR is the right default outside the fleet
//   - stacked PRs (`--base <non-default>`)
//   - non-admin viewers - a PR is their only path - and an UNKNOWN
//     permission (gh missing/unauthenticated fails OPEN; the nudge still
//     fires)
//   - an explicit PR directive from the user in recent turns ("open a
//     PR", "pull request", ...) - the owner's explicit ask wins
//
// Bypass: `Allow fleet-pr-to-main bypass` in a recent user turn.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  isFleetRepo,
  originOwnerRepo,
  originSlug,
} from '../_shared/fleet-repos.mts'
import { ghPrCreateCommands, isGhPrCreate } from '../_shared/gh-pr-command.mts'
import { resolveDefaultBranch } from '../_shared/git-branch.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import { flagValue } from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import {
  hasPrDirective,
  readRecentUserTurnTexts,
} from '../pr-vs-push-default-nudge/index.mts'

export const triggers: readonly string[] = ['pr']

// Recent user-turn window for the explicit-PR-directive escape.
export const TURN_WINDOW = 6

// Normalize an explicit `--repo` value (OWNER/REPO, HOST/OWNER/REPO, or a
// full URL) to a bare `owner/repo` slug.
export function normalizeRepoSlug(target: string): string {
  return target
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join('/')
}

export interface PrTargetRepo {
  // The `owner/repo` ref `gh repo view` accepts (case-preserved).
  ghRef: string
  // The lowercased bare repo name the fleet roster is keyed on.
  rosterName: string
}

// The repo a `gh pr create` in `command` targets: the explicit `--repo`/`-R`
// value when given, the checkout's origin remote otherwise.
export function prTargetRepo(
  command: string,
  cwd: string,
): PrTargetRepo | undefined {
  for (const c of ghPrCreateCommands(command)) {
    const explicit = flagValue(c.args, '--repo', '-R')
    if (explicit !== undefined) {
      const pair = normalizeRepoSlug(explicit)
      const name = pair.split('/').pop()
      if (!name) {
        return undefined
      }
      return { ghRef: pair, rosterName: name.toLowerCase() }
    }
  }
  const rosterName = originSlug(cwd)
  const ghRef = originOwnerRepo(cwd)
  if (!rosterName || !ghRef) {
    return undefined
  }
  return { ghRef, rosterName }
}

// Does any `gh pr create` segment target the default branch? No `--base`
// means gh defaults the base to the target repo's default branch. When the
// default branch is unknown (explicit `--repo` naming another repository), a
// literal `main`/`master` base still counts.
export function prBaseTargetsDefault(
  command: string,
  defaultBranch: string | undefined,
): boolean {
  for (const c of ghPrCreateCommands(command)) {
    const base = flagValue(c.args, '--base', '-B')
    if (base === undefined) {
      return true
    }
    if (defaultBranch !== undefined) {
      if (base === defaultBranch) {
        return true
      }
      continue
    }
    if (base === 'main' || base === 'master') {
      return true
    }
  }
  return false
}

// The gh viewer's permission on `slug` - ADMIN / MAINTAIN / WRITE / TRIAGE /
// READ - or undefined when gh is missing, unauthenticated, or errors. The
// undefined case fails OPEN at the call site: a guard must never block on a
// permission it could not read.
export function viewerPermissionFor(
  slug: string,
  cwd: string,
): string | undefined {
  const r = spawnSync(
    'gh',
    ['repo', 'view', slug, '--json', 'viewerPermission'],
    { cwd, timeout: spawnTimeoutMs(5000) /* win-timeout: network */ },
  )
  if (r.status !== 0) {
    return undefined
  }
  try {
    const parsed = JSON.parse(String(r.stdout)) as {
      viewerPermission?: string | undefined
    }
    return parsed.viewerPermission
  } catch {
    return undefined
  }
}

export interface FleetPrCreateFacts {
  command: string
  // The target repo's default branch; undefined when it cannot be resolved
  // from the checkout (explicit --repo naming another repository).
  defaultBranch: string | undefined
  // The `owner/repo` ref, for the block message.
  repoRef: string
  // The lowercased bare repo name the fleet roster is keyed on.
  rosterName: string
  userTurns: string[]
  // The gh viewer's permission on the target repo; undefined fails open.
  viewerPermission: string | undefined
}

// The pure verdict: the block message when every condition holds, undefined
// otherwise. Kept free of subprocess calls so tests drive it directly.
export function classifyFleetPrCreate(
  facts: FleetPrCreateFacts,
): string | undefined {
  if (!isFleetRepo(facts.rosterName)) {
    return undefined
  }
  if (!prBaseTargetsDefault(facts.command, facts.defaultBranch)) {
    return undefined
  }
  if (facts.viewerPermission !== 'ADMIN') {
    return undefined
  }
  if (hasPrDirective(facts.userTurns)) {
    return undefined
  }
  const base = facts.defaultBranch ?? 'main'
  return [
    '[no-fleet-pr-to-main-guard] Refusing to open a fleet PR to the default branch.',
    '',
    `  What:  gh pr create targeting \`${base}\` on ${facts.repoRef}, where your gh viewer permission is ADMIN.`,
    '  Saw:   a PR where the fleet lands by direct push; wanted the work pushed to the default branch.',
    '  Fix:   push it instead -',
    `           git push origin HEAD:${base}`,
    '         A PR is the fallback for a contributor without push rights, or',
    '         when the user explicitly asks for one.',
    '',
  ].join('\n')
}

export const check = bashGuard((command, payload) => {
  if (!isGhPrCreate(command)) {
    return undefined
  }
  const cwd = resolveProjectDir(payload.cwd)
  const target = prTargetRepo(command, cwd)
  if (!target) {
    return undefined
  }
  // Cheap fleet-membership read first so the network permission probe only
  // runs for fleet repos.
  if (!isFleetRepo(target.rosterName)) {
    return undefined
  }
  // The checkout's default branch only describes the target when the PR is
  // against the origin repo itself.
  const origin = originOwnerRepo(cwd)
  const defaultBranch =
    origin && origin.toLowerCase() === target.ghRef.toLowerCase()
      ? resolveDefaultBranch(cwd)
      : undefined
  if (!prBaseTargetsDefault(command, defaultBranch)) {
    return undefined
  }
  const userTurns = payload.transcript_path
    ? readRecentUserTurnTexts(payload.transcript_path, TURN_WINDOW)
    : []
  const message = classifyFleetPrCreate({
    command,
    defaultBranch,
    repoRef: target.ghRef,
    rosterName: target.rosterName,
    userTurns,
    viewerPermission: viewerPermissionFor(target.ghRef, cwd),
  })
  return message === undefined ? undefined : block(message)
})

export const hook = defineHook({
  bypass: ['fleet-pr-to-main'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})

void runHook(hook, import.meta.url)
