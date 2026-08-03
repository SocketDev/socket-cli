#!/usr/bin/env node
// Socket Security Pre-push Hook
//
// Mandatory enforcement layer for all pushes. Validates commits
// being pushed for AI attribution, secrets, and personal-path leaks.
//
// Architecture:
//   .git-hooks/pre-push (shell shim, invoked by git when
//   `core.hooksPath = .git-hooks`) → node .git-hooks/pre-push.mts
//
// Range logic:
//   New branch:  remote/<default_branch>..<local_sha>  only new commits
//   Existing:    <remote_sha>..<local_sha>             only new commits
//   We never derive the range FROM release tags — that would re-scan
//   already-merged history. Release tags do bound it in the other direction:
//   the force-push fallback widens the base to remote/<default_branch>, which
//   can sweep in commits a published tag already froze, so the AI-attribution
//   gate subtracts tag-reachable commits (../_shared/push-release-tags.mts).
//
// Stdin format, provided by git: one push line per ref, each line:
//   <local_ref> <local_sha> <remote_ref> <remote_sha>
//
// This entry point is a thin orchestrator: each gate lives in a focused
// `../_shared/push-*.mts` leaf, and `main` sequences them per push line.

import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

// Import `splitLines` from the barrel, not the scan-core leaf, so the Node-25
// version gate in `../_shared/helpers.mts` runs at load — every gate below
// assumes native .mts type stripping.
import { splitLines } from '../_shared/helpers.mts'
import { scanCommitMessages } from '../_shared/push-commit-messages.mts'
import { scanFilesInRange } from '../_shared/push-file-scan.mts'
import { computeRange } from '../_shared/push-range.mts'
import {
  checkSubmodules,
  scanDispatchDrift,
  scanFastChecks,
  scanSoakAnnotations,
  scanTypeCheck,
} from '../_shared/push-repo-gates.mts'
import { scanSignedCommits } from '../_shared/push-signatures.mts'
import { isSquashHistoryRepo } from '../_shared/push-squash-history.mts'

const logger = getDefaultLogger()

const readStdin = (): Promise<string> =>
  new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buf += chunk
    })
    process.stdin.on('end', () => resolve(buf))
  })

const main = async (): Promise<number> => {
  logger.info('Running mandatory pre-push validation…')

  const submoduleErrors = checkSubmodules()
  if (submoduleErrors > 0) {
    return 1
  }

  const remote = process.argv[2] || 'origin'
  // url at process.argv[3] is unused.

  const stdin = await readStdin()
  let totalErrors = 0
  const refLines = splitLines(stdin.trim()).filter(Boolean)

  for (let i = 0, { length } = refLines; i < length; i += 1) {
    const refLine = refLines[i]!
    const [localRef, localSha, remoteRef, remoteSha] = refLine.split(/\s+/)
    if (!localRef || !localSha || !remoteRef || !remoteSha) {
      continue
    }
    const range = computeRange(remote, localRef, localSha, remoteSha)
    // `computeRange` returns `undefined` for skip cases (tags, deletions, new
    // branches); use loose equality so both `null` and `undefined` skip. A
    // strict `=== null` check let `undefined` fall through and failed every
    // tag push with "Invalid commit range: undefined".
    if (range == null) {
      continue
    }
    // Validate range.
    const rl = spawnSync('git', ['rev-list', range], { stdio: 'ignore' })
    if (rl.status !== 0) {
      logger.fail(`Invalid commit range: ${range}`)
      return 1
    }

    // Only the AI-attribution gate takes the release-tag exemption. Its sole
    // remedy is a reword, which is a rewrite, which is impossible for a
    // published-tag commit. The signature and file gates keep the full range:
    // an unsigned commit or a leaked secret entering the protected branch is a
    // fact the operator must see even when the remedy is not a reword — the
    // response there is to rotate or to abandon the push, not to reword.
    totalErrors += scanCommitMessages(range, remote)
    totalErrors += scanSignedCommits(range, remoteRef)
    totalErrors += scanFilesInRange(range)
  }

  // File-targeted scans, working-tree state, not per-commit-range.
  totalErrors += scanSoakAnnotations()

  // Fast lint/format gate — the build-independent slice of the quality bar,
  // run at the push boundary so format/lint drift can't reach main.
  totalErrors += scanFastChecks()

  // Dispatch-table drift (wheelhouse-only) — a stale/dangling hook dispatch
  // can't reach origin/main and cascade fleet-wide.
  totalErrors += scanDispatchDrift()

  // Type gate — the mandatory whole-project tsc check. A type error is the one
  // class of breakage the fast lint/format gate above cannot catch, and the
  // fast-land path pushes with --no-verify, so without this a bad type reaches
  // origin/main behind CI alone. Runs AFTER the dispatch-drift check so its
  // dispatch-table regen cannot mask a stale on-disk table, and (unlike
  // scanFastChecks) it does not skip under a `.claude/` worktree path.
  totalErrors += scanTypeCheck()

  if (totalErrors > 0) {
    logger.error('')
    logger.fail('Push blocked by mandatory validation!')
    logger.error('Fix the issues above before pushing.')
    if (isSquashHistoryRepo()) {
      logger.error('')
      logger.info(
        '  squash-history repo: if the blocker above is in-flight WIP or moving-',
      )
      logger.info(
        '  target cascade/format drift from a parallel session (NOT a real',
      )
      logger.info(
        '  regression), landing it is canonical — local main is canonical and',
      )
      logger.info('  flattens. Do:')
      logger.info('    git add -A && git commit --no-verify -m "chore: …"')
      logger.info(
        '    pnpm run dogfood        # cascade WIP sources → live, resolve drift',
      )
      logger.info(
        '    git push --no-verify origin HEAD:main   # records the skip',
      )
      logger.info(
        '  Do NOT wait for a clean window or treat a parallel session’s WIP as',
      )
      logger.info('  untouchable — commit it, dogfood, force it through.')
    }
    return 1
  }

  logger.success('All mandatory validation passed!')
  return 0
}

// Explicit .catch so a thrown error in main() doesn't become an
// unhandled rejection — surface the error through the logger so the
// user sees what blocked the push, then exit 1 intentionally.
main().then(
  code => {
    process.exitCode = code
  },
  e => {
    logger.error(`pre-push: ${errorMessage(e)}`)
    process.exitCode = 1
  },
)
