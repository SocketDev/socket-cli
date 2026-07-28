#!/usr/bin/env node
/**
 * @file `check --all` gate: no git-TRACKED file is a handoff / planning doc.
 *   Handoff + planning docs are TRANSIENT agent work-state — a snapshot of one
 *   session's in-flight reasoning, never a source-controlled artifact. Their
 *   one home is the gitignored `.claude/plans/` operator-notes dir
 *   (scripts/fleet/lib/delegating-execution/prompts.mts writes plans there;
 *   private-paths-are-absent treats it as untracked notes). Incident: a
 *   `…-handoff.md` got committed to the TRACKED docs tree, shipping ephemeral
 *   work-state to 16 repos. The gitignore `/.claude/plans/` +
 *   `/.claude/reports/` entries keep the home untracked; this belt catches a
 *   handoff doc committed ANYWHERE ELSE. A doc is a handoff doc by FILENAME
 *   SUFFIX only — `path.basename` matching `…handoff.<md|mdx|markdown|txt>`
 *   where the `handoff` token is the whole stem or a `-`/`.`-delimited tail
 *   (HANDOFF.md, handoff.md, x-handoff.md, x.handoff.md). Keying off the suffix
 *   — not any path segment — is deliberate: the legit fleet hooks whose PATH
 *   contains `handoff` (.claude/hooks/fleet/handoff-command-nudge/,
 *   session-handoff-nudge/) carry basenames README.md / index.mts /
 *   package.json and never match. A doc already under `.claude/plans/` is
 *   gitignored, so `git ls-files` never lists it — the clean pass every repo
 *   starts from. Exit: 0 — no tracked handoff doc, or git is unavailable; 1 —
 *   at least one. Usage: node
 *   scripts/fleet/check/handoff-docs-are-untracked.mts [--quiet]
 */

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The gitignored operator-notes home a tracked handoff doc must move to.
export const PLANS_DIR = '.claude/plans'

// A handoff doc by filename SUFFIX: the `handoff` token is the whole stem or a
// `-`/`.`-delimited tail, with a prose extension. Suffix-only so a path segment
// carrying `handoff` (the handoff-command-nudge / session-handoff-nudge hook
// dirs, whose files are README.md / index.mts / package.json) never matches.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const HANDOFF_BASENAME_RE = /(?:^|[-.])handoff\.(?:md|mdx|markdown|txt)$/i

/**
 * True when `relPath`'s basename is a handoff doc. Pure — no IO — so the rule
 * unit-tests without a filesystem.
 */
export function isHandoffDoc(relPath: string): boolean {
  return HANDOFF_BASENAME_RE.test(path.basename(normalizePath(relPath)))
}

/**
 * The tracked handoff docs in `git ls-files` output, one path per line. Pure;
 * normalized + sorted so the finding order is deterministic.
 */
export function findTrackedHandoffDocs(lsFilesOutput: string): string[] {
  const out: string[] = []
  const lines = lsFilesOutput.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line === '') {
      continue
    }
    const norm = normalizePath(line)
    if (isHandoffDoc(norm)) {
      out.push(norm)
    }
  }
  return out.toSorted()
}

async function main(): Promise<void> {
  let output = ''
  try {
    const result = (await spawn('git', ['ls-files'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      stdioString: true,
    })) as { stdout?: string | undefined }
    output = String(result?.stdout ?? '')
  } catch {
    // git unavailable — another gate's concern; this belt is vacuous, never a
    // false-green failure on a non-git tree.
    process.exitCode = 0
    return
  }
  const offenders = findTrackedHandoffDocs(output)
  if (offenders.length === 0) {
    if (!process.argv.includes('--quiet')) {
      logger.log('handoff-docs-are-untracked: no handoff doc is tracked.')
    }
    process.exitCode = 0
    return
  }
  logger.fail(
    `handoff-docs-are-untracked: ${offenders.length} handoff doc(s) are git-tracked:`,
  )
  for (let i = 0, { length } = offenders; i < length; i += 1) {
    logger.fail(`  ${offenders[i]!}`)
  }
  logger.fail(
    '  What:  a handoff / planning doc is committed. These are TRANSIENT agent\n' +
      `         work-state, not source — their one home is the gitignored ${PLANS_DIR}/.\n` +
      '  Where: the path(s) above.\n' +
      `  Wanted: handoff docs stay out of version control (16 repos never carry them).\n` +
      `  Fix:   \`git rm --cached <path>\` then \`mv <path> ${PLANS_DIR}/\` — the doc\n` +
      `         becomes gitignored + untracked, and git ls-files stops listing it.`,
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`handoff-docs-are-untracked failed: ${String(e)}`)
    process.exitCode = 1
  })
}
/* c8 ignore stop */
