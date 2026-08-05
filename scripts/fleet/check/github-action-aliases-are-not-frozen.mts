#!/usr/bin/env node
/*
 * @file A GitHub Action's floating alias tags (`v1`, `v1.3`) are a promise: a
 *   consumer writing `owner/action@v1` is told they will keep receiving the
 *   newest `v1.*.*` release. That promise is kept by a workflow that re-points
 *   the alias on every release. Delete the workflow and leave the tags behind
 *   and the promise silently inverts — the alias freezes at whatever release it
 *   last tracked and every existing consumer is permanently downgraded to it.
 *
 *   This is a real, current state in SocketDev/action:
 *
 *     v1     -> 937f824ec  (v1.3.0, 2026-03-05)
 *     v1.3   -> 937f824ec  (v1.3.0, 2026-03-05)
 *     v1.3.2 -> ba6de6cc0  (newest release, 2026-03-27)
 *
 *   PR #9 there removed the alias-maintenance workflow and moved the README
 *   usage to commit-SHA pinning, but the alias tags were never deleted. So
 *   every workflow in the wild still saying `@v1` runs v1.3.0 forever and never
 *   receives a later release — including the zizmor workflow hardening in
 *   v1.3.1. The half-completed migration is the hazard, not either end state.
 *
 *   THE LAW. A floating alias either TRACKS the newest release on its line, or
 *   it DOES NOT EXIST. Deleting the aliases is a fully sanctioned end state and
 *   skips clean here — this check never pushes a repo back onto floating
 *   aliases, it only refuses to let a stale one keep lying.
 *
 *   DETECTION is git-only, no network and no release API:
 *
 *   1. List tags with `git tag --list` and classify each one. A RELEASE is
 *      `v<major>.<minor>.<patch>`, all numeric. An ALIAS is `v<major>` or
 *      `v<major>.<minor>`, all numeric. Everything else (prereleases,
 *      `fleet-pack-*`, arbitrary names) is ignored entirely.
 *   2. For each alias, find the newest release on its line: the greatest
 *      (major, minor, patch) tuple among releases sharing the alias's prefix.
 *      `v1` covers every `v1.*.*`; `v1.3` covers every `v1.3.*`. The compare is
 *      NUMERIC, so v1.10.0 beats v1.9.0 the way a lexical compare would not.
 *   3. Resolve both tags with `git rev-list -n 1 <tag>` so an annotated tag and
 *      a lightweight tag compare equal — an annotated tag's own object SHA is
 *      not the commit it points at.
 *   4. Different commits means the alias is frozen: a finding. Equal commits
 *      means the alias tracks the newest release: clean. An alias whose line
 *      has NO release at all answers nothing, so it is skipped rather than
 *      reported as a guessed finding.
 *
 *   SCOPE. Only a repo whose cascade roster entry declares `publishes:
 *   ["github-action"]` distributes itself by tag this way. The roster read
 *   (`loadRosterFromRepo` + `resolveRepoName` + `publishesTo`) is the gate; an
 *   unreadable roster, an unresolvable repo name, or a repo outside the
 *   `github-action` channel all skip clean with a one-line reason — never a
 *   silent no-op, and never a false positive on a repo this cannot touch.
 *
 *   MODE. Enforcing (`ENFORCING = true`): `action` is on the channel, and the
 *   two findings this gate raises there — `v1` and `v1.3` both frozen at the
 *   `v1.3.0` commit while `v1.3.2` is newest — were confirmed against the live
 *   tags. Those are true findings, not the false positives report-only mode
 *   existed to absorb, so the gate blocks until the tags are moved or deleted.
 *
 *   Exit codes: 0 — not applicable, clean, or a finding while ENFORCING is
 *   off; 1 — a finding while ENFORCING is on.
 *   Usage: node scripts/fleet/check/github-action-aliases-are-not-frozen.mts
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  loadRosterFromRepo,
  publishesTo,
  resolveRepoName,
} from '../../../.claude/hooks/fleet/_shared/fleet-roster.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// Enforcing: `action` is on the channel, and its two findings (v1 and v1.3
// both frozen at the v1.3.0 commit while v1.3.2 is newest) were confirmed
// against the live tags — true findings, not the false positives report-only
// mode existed to absorb.
const ENFORCING = true

export type ActionTagKind = 'alias' | 'ignored' | 'release'

/**
 * One alias tag with everything the decision needs already resolved: where the
 * alias points, and the newest release on its line plus where THAT points.
 *
 * `newestRelease`/`newestReleaseCommit` are `undefined` when the alias's line
 * carries no release at all — nothing to compare against, so nothing to say.
 */
export interface AliasTagResolution {
  readonly alias: string
  readonly aliasCommit: string
  readonly newestRelease: string | undefined
  readonly newestReleaseCommit: string | undefined
}

export interface FrozenAliasFinding {
  readonly alias: string
  readonly aliasCommit: string
  readonly newestRelease: string
  readonly newestReleaseCommit: string
}

/**
 * Sort a tag into the three buckets this check cares about.
 *
 * `v1.3.2` is a release, `v1` and `v1.3` are floating aliases, and anything
 * else — a prerelease like `v1.3.0-beta.1`, a `fleet-pack-*` marker, a bare
 * `latest` — is ignored, because this check has no opinion on tags that were
 * never a semver line in the first place.
 */
export function classifyActionTagKind(tag: string): ActionTagKind {
  if (!tag.startsWith('v')) {
    return 'ignored'
  }
  const segments = tag.slice(1).split('.')
  if (segments.length < 1 || segments.length > 3) {
    return 'ignored'
  }
  if (!segments.every(segment => /^\d+$/.test(segment))) {
    return 'ignored'
  }
  return segments.length === 3 ? 'release' : 'alias'
}

// The numeric (major, minor, patch) of a release tag, or `undefined` when the
// tag is not a release at all.
function releaseVersionTuple(tag: string): number[] | undefined {
  if (classifyActionTagKind(tag) !== 'release') {
    return undefined
  }
  return tag.slice(1).split('.').map(Number)
}

// Compare two release tuples position by position, greatest-first semantics:
// positive when `left` is newer. Numeric, so 10 beats 9.
function compareReleaseTuples(
  left: readonly number[],
  right: readonly number[],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

/**
 * The newest release on `alias`'s line, or `undefined` when that line has none.
 *
 * The alias's numeric segments are the prefix a release must match: `v1` keeps
 * every release whose major is 1, `v1.3` narrows that to minor 3. The winner is
 * the greatest tuple by numeric compare, which is why `v1.10.0` correctly beats
 * `v1.9.0` — a lexical compare would pick `v1.9.0`.
 */
export function newestReleaseForAlias(
  alias: string,
  releases: readonly string[],
): string | undefined {
  if (classifyActionTagKind(alias) !== 'alias') {
    return undefined
  }
  const aliasSegments = alias.slice(1).split('.').map(Number)
  let newestTag: string | undefined
  let newestTuple: number[] | undefined
  for (const release of releases) {
    const tuple = releaseVersionTuple(release)
    if (!tuple) {
      continue
    }
    if (!aliasSegments.every((segment, index) => tuple[index] === segment)) {
      continue
    }
    if (!newestTuple || compareReleaseTuples(tuple, newestTuple) > 0) {
      newestTag = release
      newestTuple = tuple
    }
  }
  return newestTag
}

/**
 * The pure decision: which of these aliases are frozen?
 *
 * An alias is frozen when it resolves to a different commit than the newest
 * release on its line. Equal commits are clean. A missing commit or a line with
 * no release answers nothing, so it is skipped — never a guessed finding.
 */
export function judgeFrozenAliases(
  resolutions: readonly AliasTagResolution[],
): readonly FrozenAliasFinding[] {
  const findings: FrozenAliasFinding[] = []
  for (const resolution of resolutions) {
    const { alias, aliasCommit, newestRelease, newestReleaseCommit } =
      resolution
    if (!aliasCommit || !newestRelease || !newestReleaseCommit) {
      continue
    }
    if (aliasCommit === newestReleaseCommit) {
      continue
    }
    findings.push({ alias, aliasCommit, newestRelease, newestReleaseCommit })
  }
  return findings
}

/**
 * The human-readable finding for a frozen alias, naming both tags and both
 * commits so the reader can `git log` the gap.
 *
 * The fix names the forward move FIRST because it is the operation a fleet repo
 * can actually perform. `fleet-tag-protection` matches `refs/tags/v*` with a
 * `deletion` rule, so deleting an alias needs a ruleset exemption — while
 * moving one to a DESCENDANT commit is a fast-forward ref update, which the
 * companion `non_fast_forward` rule does not bar. Leading with deletion sent
 * the reader into a push the org's own rules reject.
 */
export function formatFrozenAliasFinding(
  finding: FrozenAliasFinding,
  repoName: string,
): string {
  const { alias, aliasCommit, newestRelease, newestReleaseCommit } = finding
  return (
    `[github-action-aliases-are-not-frozen] the ${alias} alias is frozen at ` +
    `${aliasCommit.slice(0, 12)} while ${newestRelease} is the newest release ` +
    `on that line — every consumer pinned to ${alias} is stuck on the old commit.\n` +
    `  What:   a workflow pinning \`${repoName}@${alias}\` runs the frozen commit, ` +
    `never the newest release.\n` +
    `  Where:  \`${alias}\` -> ${aliasCommit}; newest on that line is ` +
    `\`${newestRelease}\` -> ${newestReleaseCommit}.\n` +
    `  Saw:    alias points at an older commit than the newest release on its line.\n` +
    `  Fix:    move the alias forward to ${newestRelease} — a descendant commit, ` +
    `so it is a fast-forward ref update that tag protection allows. Deleting the ` +
    `alias instead needs a fleet-tag-protection exemption, since that ruleset ` +
    `carries a deletion rule on refs/tags/v*.`
  )
}

// Every tag name in this repo, or an empty list when git cannot answer.
function listGitTags(repoRoot: string): string[] {
  const result = spawnSync('git', ['tag', '--list'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (result.status !== 0) {
    return []
  }
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

// The commit a tag points at. `rev-list -n 1` peels an annotated tag down to
// its commit, so an annotated tag and a lightweight tag on the same commit
// compare equal.
function commitForTag(repoRoot: string, tag: string): string | undefined {
  const result = spawnSync('git', ['rev-list', '-n', '1', tag], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (result.status !== 0) {
    return undefined
  }
  const sha = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  return sha || undefined
}

export function main(): void {
  const roster = loadRosterFromRepo(REPO_ROOT)
  if (!roster) {
    logger.log(
      '[github-action-aliases-are-not-frozen] SKIPPED — no cascade roster resolved.',
    )
    return
  }
  const repoName = resolveRepoName(REPO_ROOT)
  if (!repoName) {
    logger.log(
      '[github-action-aliases-are-not-frozen] SKIPPED — could not resolve this repo’s roster name.',
    )
    return
  }
  if (!publishesTo(roster, repoName, 'github-action')) {
    logger.log(
      `[github-action-aliases-are-not-frozen] SKIPPED — ${repoName} does not publish to the github-action channel.`,
    )
    return
  }

  const aliases: string[] = []
  const releases: string[] = []
  for (const tag of listGitTags(REPO_ROOT)) {
    const kind = classifyActionTagKind(tag)
    if (kind === 'alias') {
      aliases.push(tag)
    } else if (kind === 'release') {
      releases.push(tag)
    }
  }

  if (!aliases.length) {
    logger.log(
      '[github-action-aliases-are-not-frozen] no floating alias tags — consumers pin a release or a commit SHA.',
    )
    return
  }

  const resolutions: AliasTagResolution[] = aliases.map(alias => {
    const newestRelease = newestReleaseForAlias(alias, releases)
    return {
      alias,
      aliasCommit: commitForTag(REPO_ROOT, alias) ?? '',
      newestRelease,
      newestReleaseCommit: newestRelease
        ? commitForTag(REPO_ROOT, newestRelease)
        : undefined,
    }
  })
  const findings = judgeFrozenAliases(resolutions)

  if (!findings.length) {
    logger.log(
      `[github-action-aliases-are-not-frozen] every alias tag (${aliases.join(', ')}) tracks the newest release on its line.`,
    )
    return
  }

  const report = ENFORCING ? logger.fail : logger.warn
  for (const finding of findings) {
    report.call(logger, formatFrozenAliasFinding(finding, repoName))
  }
  if (ENFORCING) {
    process.exitCode = 1
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'verifies floating action alias tags track the newest release on their line',
  help: 'Usage: node scripts/fleet/check/github-action-aliases-are-not-frozen.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
