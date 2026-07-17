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
 *   against its own tree. Exit codes: 0 — every registration resolves;
 *   1 — dangling registration(s).
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
  for (const copy of copies) {
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
