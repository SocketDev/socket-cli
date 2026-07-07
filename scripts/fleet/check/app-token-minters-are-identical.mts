/**
 * @file Code-as-law single-source gate for the in-house app-token minter. The
 *   minter (`mint-app-installation-token.mjs`) is CO-LOCATED inside each
 *   app-token composite action directory so it travels with the action when a
 *   member consumes it cross-repo (`uses: …/actions/<x>@<sha>` → the action's
 *   own dir is fetched, reachable via `$GITHUB_ACTION_PATH`). Co-location means
 *   N physical copies; this gate asserts every copy is byte-identical to a
 *   single reference — the blessed "inlined at build" form of
 *   single-source-of-truth. A drifted copy means one action mints with stale
 *   logic while the others moved on. Scans the live `.github/actions/**` and
 *   the cascaded source under `template/base/.github/actions/**` +
 *   `template/overrides/socket-registry/.github/actions/**`. Exit 0 = 0/1
 *   copies, or all identical. Exit 1 = drift, listed with What / Where /
 *   Saw-vs-wanted / Fix. CI gate via `scripts/check.mts`. Usage: node
 *   scripts/fleet/check/app-token-minters-are-identical.mts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const MINTER_NAME = 'mint-app-installation-token.mjs'

export interface MinterCopy {
  content: string
  relPath: string
}

// The action-hosting roots to scan: the live tree, the cascaded base, and the
// socket-registry override (which hosts the shared github-release-/github-pr-app-token).
function actionRoots(repoRoot: string): string[] {
  return [
    path.join(repoRoot, '.github', 'actions'),
    path.join(repoRoot, 'template', 'base', '.github', 'actions'),
    path.join(
      repoRoot,
      'template',
      'overrides',
      'socket-registry',
      '.github',
      'actions',
    ),
  ]
}

// Recursively collect every co-located minter file under `dir` (if it exists).
export function collectMinters(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      out.push(...collectMinters(full))
    } else if (name === MINTER_NAME) {
      out.push(full)
    }
  }
  return out
}

// Pure drift detector: the relPaths whose content differs from the first copy
// (the reference). Empty = 0/1 copies, or every copy identical.
export function findDrift(copies: MinterCopy[]): string[] {
  if (copies.length < 2) {
    return []
  }
  const ref = copies[0]!.content
  const drift: string[] = []
  for (let i = 1, { length } = copies; i < length; i += 1) {
    if (copies[i]!.content !== ref) {
      drift.push(copies[i]!.relPath)
    }
  }
  return drift
}

export function runCheck(repoRoot: string): number {
  const copies: MinterCopy[] = []
  for (const root of actionRoots(repoRoot)) {
    for (const full of collectMinters(root)) {
      copies.push({
        content: readFileSync(full, 'utf8'),
        relPath: path.relative(repoRoot, full),
      })
    }
  }
  const drift = findDrift(copies)
  if (drift.length === 0) {
    return 0
  }
  logger.fail(
    [
      `[app-token-minters-are-identical] The co-located ${MINTER_NAME} has drifted.`,
      '',
      '  Every app-token composite action carries a byte-identical copy of the',
      '  minter (co-located so it travels via $GITHUB_ACTION_PATH cross-repo).',
      '  These copies diverged from the reference:',
      '',
      `    reference: ${copies[0]!.relPath}`,
      ...drift.map(d => `    drifted:   ${d}`),
      '',
      '  Fix: copy the reference over each drifted copy so all are identical,',
      '  then re-run. (Edit the canonical source once, then replicate.)',
      '',
    ].join('\n'),
  )
  return 1
}

function main(): void {
  process.exitCode = runCheck(REPO_ROOT)
}

try {
  main()
} catch (e) {
  logger.error(e)
  process.exitCode = 1
}
