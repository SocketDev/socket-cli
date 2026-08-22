/*
 * @file Commit-time backstop for the fleet-fork rule. A fleet-canonical path
 *   (per .gitattributes `linguist-generated=true`) lives only in `template/`
 *   and is cascaded out via sync-scaffolding, which commits with
 *   `--no-verify` — a legitimate cascade commit never reaches this hook.
 *   Anything staged on a canonical path here was written outside the
 *   cascade: an Edit/Write/Bash tool call, a background Workflow `agent()`
 *   subagent (whose Bash reaches PreToolUse with the PARENT transcript, so
 *   the `no-fleet-fork-guard` PreToolUse hook cannot attribute or block it —
 *   see docs/agents.md/fleet/agent-delegation.md), or a hand-run git command.
 *   A git hook fires for every commit regardless of which process or agent
 *   ran `git commit`, so this closes the gap the tool-call guard cannot
 *   reach.
 *
 *   Reuses the exact decision inputs `no-fleet-fork-guard` already uses
 *   (fleetCanonicalEntries / isPerRepoMarkerPath / isOperatorLocalPath /
 *   textHasFleetBlockMarkers) from
 *   .claude/hooks/fleet/_shared/{fleet-fork,fleet-markers}.mts, so the two
 *   enforcement points can never disagree about what counts as canonical.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  fleetCanonicalEntries,
  isOperatorLocalPath,
  isPerRepoMarkerPath,
} from '../../.claude/hooks/fleet/_shared/fleet-fork.mts'
import { textHasFleetBlockMarkers } from '../../.claude/hooks/fleet/_shared/fleet-markers.mts'

// The template trees a live path can be cascaded from. `base` maps directly;
// `conditional` and `overrides` interpose one directory level - a capability
// name, or a member name - so each of their children is a candidate.
const TEMPLATE_ROOTS: readonly string[] = ['base', 'conditional', 'overrides']

/**
 * Candidate template sources for a live repo-relative path.
 */
export function templateTwinPaths(repoRoot: string, file: string): string[] {
  const candidates = [path.join(repoRoot, 'template', 'base', file)]
  for (let i = 1, { length } = TEMPLATE_ROOTS; i < length; i += 1) {
    const root = path.join(repoRoot, 'template', TEMPLATE_ROOTS[i]!)
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (let j = 0, { length: namesLength } = names; j < namesLength; j += 1) {
      candidates.push(path.join(root, names[j]!, file))
    }
  }
  return candidates
}

/**
 * Whether the live content is byte-identical to one of its template twins.
 *
 * Then it is cascade OUTPUT, not a fork: a fork is a live copy that DIVERGED
 * from canonical. The cascade lands its own mirrors outside this hook chain,
 * but when it loses the index lock to a parallel session it leaves them staged,
 * and only the operator can land them. Refusing that commit leaves no reachable
 * fix - the tool-call guard forbids writing the mirror by hand, and the cascade
 * cannot retry while the lock is held - so the operator's only remaining route
 * is skipping every hook, which is strictly worse than this exemption.
 */
export function matchesTemplateTwin(
  repoRoot: string,
  file: string,
  content: string,
): boolean {
  const candidates = templateTwinPaths(repoRoot, file)
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    let twin: string
    try {
      twin = readFileSync(candidates[i]!, 'utf8')
    } catch {
      continue
    }
    if (twin === content) {
      return true
    }
  }
  return false
}

export interface CanonicalForkFinding {
  file: string
}

function isInsideTemplateRelative(file: string): boolean {
  return file === 'template' || file.startsWith('template/')
}

/**
 * Every staged path (repo-relative, POSIX-normalized, add/change/modify
 * only — a caller filters deletions out via `--diff-filter=ACM`) that is
 * fleet-canonical and was staged OUTSIDE the cascade. Pure aside from the
 * file reads the fleet-block-marker allowance needs.
 */
export function scanCanonicalForkPaths(
  stagedFiles: readonly string[],
  repoRoot: string,
): CanonicalForkFinding[] {
  const entries = fleetCanonicalEntries(repoRoot)
  if (entries.length === 0) {
    return []
  }
  const findings: CanonicalForkFinding[] = []
  for (let i = 0, { length } = stagedFiles; i < length; i += 1) {
    const file = stagedFiles[i]!
    if (isInsideTemplateRelative(file)) {
      continue
    }
    if (isPerRepoMarkerPath(file) || isOperatorLocalPath(file)) {
      continue
    }
    let isCanonical = false
    for (
      let j = 0, { length: entriesLength } = entries;
      j < entriesLength;
      j += 1
    ) {
      const entry = entries[j]!
      // Glob entries are best-effort excluded here too — same conservative
      // call `isCanonicalRelativePath` makes, so a bad pattern can never
      // over-block a commit.
      if (entry.includes('*')) {
        continue
      }
      if (file === entry || file.startsWith(`${entry}/`)) {
        isCanonical = true
        break
      }
    }
    if (!isCanonical) {
      continue
    }
    // Fleet-block allowance: a canonical file carrying `<fleet-canonical>`
    // markers is only PART fleet-managed — content outside the markers is
    // repo-owned, so staging it is normal repo work, not a fork.
    let content = ''
    try {
      content = readFileSync(path.join(repoRoot, file), 'utf8')
    } catch {
      // Unreadable (permissions, binary) — fall through as non-exempt; a
      // canonical path staged unreadable is still worth surfacing.
    }
    if (textHasFleetBlockMarkers(content)) {
      continue
    }
    // Byte-identical to canonical is propagation, not divergence.
    if (matchesTemplateTwin(repoRoot, file, content)) {
      continue
    }
    findings.push({ file })
  }
  return findings
}
