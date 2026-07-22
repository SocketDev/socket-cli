#!/usr/bin/env node
/**
 * @file DEAD-CODE gate: a fleet member is a SIBLING repo (~/projects/<name> →
 *   SocketDev/<name>), NEVER a subdirectory of the wheelhouse. A directory at
 *   the wheelhouse root whose name matches a roster member is a STRAY scaffold
 *   someone left in-tree — a full fleet-scaffold copy with no unique source,
 *   pure dead code. It also gets swept into cascade commits (a stray `meander/`
 *   once put 2174 files into the wheelhouse). This fails LOUD so the stray is
 *   REMOVED — not gitignored: hiding dead code lets it rot and re-sweep. The
 *   real member always lives at the sibling ~/projects/<name>. Wheelhouse-only:
 *   fleet-repos.json is the wheelhouse's private roster, absent in members →
 *   vacuous pass. Usage: node
 *   scripts/fleet/check/member-dirs-are-not-nested.mts.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { fleetReposPath, parseFleetRepos } from './member-ci-fires-on-push.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

/**
 * Roster member names that exist as a DIRECTORY at the wheelhouse root — each
 * is a stray nested scaffold (dead code), since a member is a sibling repo,
 * never a subdir. Pure; exported for tests.
 */
export function findNestedMemberDirs(
  repoRoot: string,
  memberNames: readonly string[],
): string[] {
  const out: string[] = []
  for (let i = 0, { length } = memberNames; i < length; i += 1) {
    const name = memberNames[i]!
    const abs = path.join(repoRoot, name)
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      out.push(name)
    }
  }
  return out.sort()
}

export function main(): void {
  const reposPath = fleetReposPath(REPO_ROOT)
  if (!existsSync(reposPath)) {
    // A member checkout has no private roster — nothing to check.
    return
  }
  let names: string[]
  try {
    names = parseFleetRepos(readFileSync(reposPath, 'utf8')).map(r => r.name)
  } catch (e) {
    logger.fail(
      `member-dirs-are-not-nested: could not read fleet-repos.json — ${errorMessage(e)}`,
    )
    process.exitCode = 1
    return
  }
  const nested = findNestedMemberDirs(REPO_ROOT, names)
  if (nested.length === 0) {
    logger.success(
      'member-dirs-are-not-nested: no fleet member is nested in the wheelhouse.',
    )
    return
  }
  logger.fail(
    `member-dirs-are-not-nested: ${nested.length} stray member scaffold(s) nested in the wheelhouse (DEAD CODE):`,
  )
  for (const name of nested) {
    logger.fail(
      `  ${name}/ — a member is a SIBLING repo (~/projects/${name} → SocketDev/${name}), never a wheelhouse subdir.`,
    )
  }
  logger.fail(
    '  Remove it (`git rm -r <name>/`) — do NOT gitignore it (hiding dead code lets it rot and lets the cascade re-sweep it).',
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main()
}
/* c8 ignore stop */
