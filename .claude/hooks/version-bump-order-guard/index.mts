#!/usr/bin/env node
// Claude Code PreToolUse hook — version-bump-order-guard.
//
// Blocks `git tag vX.Y.Z` invocations when the prep wave or the bump
// commit hasn't landed yet. The fleet's "Version bumps" rule says:
//
//   1. `pnpm run update` → `pnpm i` → `pnpm run fix --all` → `pnpm run
//      check --all` (each clean before the next).
//   2. CHANGELOG.md entry — public-facing only.
//   3. The `chore: bump version to X.Y.Z` commit is the LAST commit on
//      the release branch.
//   4. THEN `git tag vX.Y.Z` at the bump commit.
//   5. Do NOT dispatch the publish workflow.
//
// This hook is a guard around step 4: when the user runs `git tag
// v...`, the most-recent commit on HEAD must look like a bump commit
// (its subject matches `bump version to X.Y.Z` or `chore: release
// X.Y.Z`). Without that, the tag is being placed on a non-bump commit,
// which produces a broken release.
//
// Bypass: "Allow version-bump-order bypass" in a recent user turn, or
// SOCKET_VERSION_BUMP_ORDER_GUARD_DISABLED=1.

import { execSync } from 'node:child_process'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface PreToolUsePayload {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly command?: unknown } | undefined
  readonly transcript_path?: string | undefined
  readonly cwd?: string | undefined
}

const BYPASS_PHRASES = [
  'Allow version-bump-order bypass',
  'Allow version bump order bypass',
  'Allow versionbumporder bypass',
] as const

// `git tag <name>` (also `git tag -a`, `git tag -s`, etc.). We want
// version tags specifically (`vX.Y.Z`).
const VERSION_TAG_RE = /\bgit\s+tag\b[^|;&\n]*\bv\d+\.\d+\.\d+\b/

// Subject patterns that count as a "bump commit". Matches Keep-a-
// Changelog style and Conventional Commits style.
const BUMP_SUBJECT_RE =
  /^(chore(?:\([\w-]+\))?:\s+(?:bump version to|release)\s+v?\d+\.\d+\.\d+|chore(?:\([\w-]+\))?:\s+v?\d+\.\d+\.\d+\s+release)/i

async function main(): Promise<void> {
  if (process.env['SOCKET_VERSION_BUMP_ORDER_GUARD_DISABLED']) {
    process.exit(0)
  }
  const payloadRaw = await readStdin()
  let payload: PreToolUsePayload
  try {
    payload = JSON.parse(payloadRaw) as PreToolUsePayload
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }
  const command = payload.tool_input?.['command']
  if (typeof command !== 'string') {
    process.exit(0)
  }
  if (!VERSION_TAG_RE.test(command)) {
    process.exit(0)
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    process.exit(0)
  }

  // Read the most-recent commit subject from HEAD.
  const opts = payload.cwd
    ? { encoding: 'utf8' as const, cwd: payload.cwd }
    : { encoding: 'utf8' as const }
  let headSubject = ''
  try {
    headSubject = execSync('git log -1 --pretty=%s', opts).trim()
  } catch {
    // Not a git repo or git unavailable — fail open.
    process.exit(0)
  }
  if (BUMP_SUBJECT_RE.test(headSubject)) {
    process.exit(0)
  }

  // Look up whether CHANGELOG.md was touched in HEAD.
  let changelogTouched = false
  try {
    const files = execSync('git show --name-only --pretty= HEAD', opts).trim()
    changelogTouched = /\bCHANGELOG\.md\b/i.test(files)
  } catch {
    // ignore
  }

  const lines = [
    '[version-bump-order-guard] Tagging vX.Y.Z but HEAD is not a bump commit.',
    '',
    `  HEAD subject : ${headSubject}`,
    `  CHANGELOG.md : ${changelogTouched ? 'touched' : 'NOT touched'} in HEAD`,
    '',
    '  Per CLAUDE.md "Version bumps", the bump commit must be the LAST',
    '  commit on the release. Expected subject shape:',
    '',
    '    chore: bump version to X.Y.Z',
    '    chore(scope): release X.Y.Z',
    '',
    '  If a bump commit exists earlier in history, rebase it forward to',
    '  the tip. If it doesn\'t exist yet, run the prep wave first:',
    '',
    '    pnpm run update',
    '    pnpm i',
    '    pnpm run fix --all',
    '    pnpm run check --all',
    '',
    '  Then update CHANGELOG.md and commit `chore: bump version to X.Y.Z`',
    '  carrying package.json + CHANGELOG.md. Then tag.',
    '',
    '  Bypass: type "Allow version-bump-order bypass" in a recent message.',
    '',
  ]
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(2)
}

main().catch(() => {
  process.exit(0)
})
