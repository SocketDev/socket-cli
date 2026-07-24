#!/usr/bin/env node
/*
 * @file Every check registered in check.mts / _shared/check-steps*.mts must exist — in the worktree
 *   AND in the git index. A pathspec-scoped commit (cascade sync, `git
 *   commit --only`) can split an atomic change: the check.mts registration
 *   lands while the new check file stays untracked, and HEAD is broken for
 *   everyone until a follow-up commit (this happened — a cascade swept a
 *   staged registration whose check file wasn't in its pathspec). The
 *   runtime failure inside `check --all` is loud but LATE: it fires after
 *   the split commit lands and starts propagating. This gate moves the
 *   signal to the actor creating the split — the index pass reads the
 *   STAGED check.mts (`git show :<path>`) and requires every registration
 *   it names to resolve in the index, so a pre-commit `check` run (or any
 *   local run with the split staged) fails before the commit exists.
 *   Covers the wheelhouse's own copy and template/base/'s seed copy, each
 *   against its own tree. A REVERSE pass also fires: every fleet check file
 *   must be WIRED into a runner (check-steps / package.json / workflow) or on
 *   the deferred allowlist — catching the inert-enforcer class (a tested check
 *   that no runner invokes, so it runs never). Exit codes: 0 — every
 *   registration resolves + every check is wired; 1 — a dangling registration
 *   or an unwired check.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Registered checks appear as 'scripts/fleet/check/<name>.mts' string
// literals inside run() calls; repo-owned checks are discovered from
// scripts/repo/check/ at runtime and never registered by literal, so this
// is the complete registration surface.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const REGISTRATION_RE = /'(scripts\/fleet\/check\/[\w-]+\.mts)'/g

// Any reference to a fleet check path (quoted or bare) — used by the reverse
// gate to decide a check is WIRED into some runner (check-steps, package.json
// script, workflow, git-hook), not just the quoted check-steps registration.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const CHECK_PATH_RE = /scripts\/fleet\/check\/[\w-]+\.mts/g

/**
 * Every check path a check.mts source registers, deduplicated in order.
 */
export function extractRegisteredCheckPaths(source: string): string[] {
  const seen = new Set<string>()
  for (const m of source.matchAll(REGISTRATION_RE)) {
    seen.add(m[1]!)
  }
  return [...seen]
}

/**
 * Registrations whose check file the given resolver cannot find. Pure so
 * the worktree, index, and unit-test passes share one implementation.
 */
export function findDanglingRegistrations(
  registered: string[],
  resolves: (relPath: string) => boolean,
): string[] {
  return registered.filter(p => !resolves(p))
}

function gitShowStaged(relPath: string): string | undefined {
  const res = spawnSync('git', ['show', `:${relPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return res.status === 0 ? String(res.stdout) : undefined
}

function gitIndexPaths(): Set<string> | undefined {
  const res = spawnSync('git', ['ls-files', '--cached'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return res.status === 0
    ? new Set(String(res.stdout).split('\n').filter(Boolean))
    : undefined
}

// The registration surface of one tree: check.mts plus every
// _shared/check-steps*.mts domain module. Discovered by prefix so a future
// domain split is covered without editing this gate.
export function registrationSources(
  repoRoot: string,
  treePrefix: string,
): string[] {
  const out = [`${treePrefix}scripts/fleet/check.mts`]
  const sharedDir = path.join(repoRoot, treePrefix, 'scripts/fleet/_shared')
  if (existsSync(sharedDir)) {
    for (const f of readdirSync(sharedDir)) {
      if (f.startsWith('check-steps') && f.endsWith('.mts')) {
        out.push(`${treePrefix}scripts/fleet/_shared/${f}`)
      }
    }
  }
  return out
}

// Fleet checks that are DELIBERATELY not wired into any `check --all` runner
// (each with the reason it stands alone) — the reverse gate's allowlist. A
// standalone check invoked only manually / post-publish belongs here so the
// gate stays loud about the ACCIDENTALLY-orphaned enforcer (the class that let
// publishable-version-is-prerelease-hint sit inert), not the intentional one.
export const DEFERRED_CHECKS: Readonly<Record<string, string>> = {
  __proto__: null,
  // Post-publish registry audit — run against a published version, not part of
  // the pre-publish source `check --all` (its source twin is
  // publish-config-is-hardened, which IS registered).
  'scripts/fleet/check/provenance-is-attested.mts':
    'post-publish registry audit, run manually against a published version',
} as unknown as Record<string, string>

// Every fleet check file that exists in a tree, as `<treePrefix>scripts/fleet/
// check/<name>.mts` rel paths — the reverse gate's inventory.
export function listFleetCheckFiles(
  repoRoot: string,
  treePrefix: string,
): string[] {
  const dir = path.join(repoRoot, treePrefix, 'scripts/fleet/check')
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter(f => f.endsWith('.mts'))
    .map(f => `${treePrefix}scripts/fleet/check/${f}`)
}

// Check files that no runner references and that aren't on the deferred
// allowlist — the inert enforcers. `wired` is the set of check rel paths named
// anywhere a runner would invoke them (check-steps + check.mts + package.json +
// workflows + git-hooks); `deferred` is the reason-annotated allowlist. Pure.
export function findUnregisteredChecks(
  checkFiles: readonly string[],
  wired: ReadonlySet<string>,
  deferred: Readonly<Record<string, string>>,
): string[] {
  return checkFiles.filter(f => {
    const bare = f.replace(/^template\/base\//, '')
    return !wired.has(bare) && !Object.hasOwn(deferred, bare)
  })
}

// Every fleet-check rel path (bare, treePrefix-stripped) referenced by a runner
// in `treePrefix`: the check-steps/check.mts registrations PLUS package.json
// scripts and CI workflows (where standalone checks are invoked). A check named
// in any of these is WIRED.
export function collectWiredChecks(
  repoRoot: string,
  treePrefix: string,
): Set<string> {
  const files = registrationSources(repoRoot, treePrefix).map(p =>
    path.join(repoRoot, p),
  )
  const pkg = path.join(repoRoot, treePrefix, 'package.json')
  if (existsSync(pkg)) {
    files.push(pkg)
  }
  const wfDir = path.join(repoRoot, treePrefix, '.github/workflows')
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir)) {
      if (f.endsWith('.yaml') || f.endsWith('.yml')) {
        files.push(path.join(wfDir, f))
      }
    }
  }
  const wired = new Set<string>()
  for (let i = 0, { length } = files; i < length; i += 1) {
    const abs = files[i]!
    if (!existsSync(abs)) {
      continue
    }
    for (const m of readFileSync(abs, 'utf8').matchAll(CHECK_PATH_RE)) {
      wired.add(m[0])
    }
  }
  return wired
}

async function main(): Promise<void> {
  // Each tree (the repo's own + template/base/'s seed) resolves its
  // registrations against itself.
  const copies = ['', 'template/base/'].flatMap(treePrefix =>
    registrationSources(REPO_ROOT, treePrefix).map(checkMts => ({
      checkMts,
      treePrefix,
    })),
  )
  const errors: string[] = []
  const indexPaths = gitIndexPaths()
  for (let i = 0, { length } = copies; i < length; i += 1) {
    const copy = copies[i]!
    const abs = path.join(REPO_ROOT, copy.checkMts)
    if (!existsSync(abs)) {
      continue
    }
    // Worktree pass: what a plain `check --all` run executes.
    const worktree = findDanglingRegistrations(
      extractRegisteredCheckPaths(readFileSync(abs, 'utf8')),
      rel => existsSync(path.join(REPO_ROOT, copy.treePrefix, rel)),
    )
    for (const rel of worktree) {
      errors.push(
        `${copy.checkMts} registers ${copy.treePrefix}${rel}, which does not exist.\n` +
          `    Fix: add the check file, or remove the registration — they move together.`,
      )
    }
    // Index pass: what committing RIGHT NOW would publish. Catches the
    // split before the commit exists instead of after it propagates.
    const staged = gitShowStaged(copy.checkMts)
    if (staged !== undefined && indexPaths) {
      const index = findDanglingRegistrations(
        extractRegisteredCheckPaths(staged),
        rel => indexPaths.has(`${copy.treePrefix}${rel}`),
      )
      for (const rel of index) {
        errors.push(
          `${copy.checkMts} (staged) registers ${copy.treePrefix}${rel}, which is not in the git index.\n` +
            `    Committing now splits an atomic change and breaks HEAD's \`check --all\`.\n` +
            `    Fix: \`git add ${copy.treePrefix}${rel}\` so the registration and the check land together.`,
        )
      }
    }
  }
  // Reverse pass: every fleet check file must be WIRED into a runner (or on the
  // deferred allowlist). The forward pass catches registered→missing; this
  // catches exists→unwired — the inert-enforcer class that let a tested check
  // (publishable-version-is-prerelease-hint) sit in the tree running never.
  // Scoped to the ROOT tree only: that's the real runtime (its package.json is
  // the GENERATED one that invokes standalone checks); template/base/'s
  // package.json is a minimal seed, so a package.json-invoked check would
  // false-positive there. The template check files are cascaded copies of the
  // root's, so root coverage is authoritative.
  const orphaned = findUnregisteredChecks(
    listFleetCheckFiles(REPO_ROOT, ''),
    collectWiredChecks(REPO_ROOT, ''),
    DEFERRED_CHECKS,
  )
  for (const rel of orphaned) {
    errors.push(
      `${rel} is a check file no runner invokes (not in check-steps, package.json, or a workflow).\n` +
        `    It runs NEVER — a tested enforcer that's policy on paper.\n` +
        `    Fix: register it in a _shared/check-steps*.mts (or a package.json script),\n` +
        `    or add it to DEFERRED_CHECKS in this file with the reason it stands alone.`,
    )
  }
  if (errors.length) {
    logger.error(`check-registrations-resolve: ${errors.length} finding(s):`)
    for (let i = 0, { length } = errors; i < length; i += 1) {
      logger.error(`  ${errors[i]!}`)
    }
    process.exitCode = 1
    return
  }
  logger.success(
    'every registered check resolves in the worktree and the index.',
  )
}

main().catch((e: unknown) => {
  logger.error(`check-registrations-resolve failed: ${errorMessage(e)}`)
  process.exitCode = 1
})
