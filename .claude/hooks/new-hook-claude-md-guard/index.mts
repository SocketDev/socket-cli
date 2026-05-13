#!/usr/bin/env node
// Claude Code PreToolUse hook — new-hook-claude-md-guard.
//
// Blocks Write/Edit operations that create or modify a hook's
// `index.mts` unless the relevant CLAUDE.md contains an
// `(enforced by `.claude/hooks/<hook-name>/`)` reference.
//
// Two-mode behavior:
//
//   1. In socket-wheelhouse (path matches `template/.claude/hooks/`):
//      checks `template/CLAUDE.md` — the fleet-canonical source.
//      Forces any new hook to land alongside a documented rule.
//
//   2. In every fleet repo (path matches `.claude/hooks/` at repo
//      root): checks the repo's `CLAUDE.md`. Catches downstream
//      forks — if someone adds a hook locally (against the
//      no-fleet-fork rule), the missing citation in the cascaded
//      fleet block blocks the edit. Defense in depth on top of
//      no-fleet-fork-guard.
//
// Fires on:
//   - Write to `<repo>/template/.claude/hooks/<name>/index.mts` (wheelhouse)
//   - Edit to `<repo>/template/.claude/hooks/<name>/index.mts` (wheelhouse)
//   - Write/Edit to `<repo>/.claude/hooks/<name>/index.mts` (any fleet repo)
//
// Skips:
//   - `_shared/` (not a hook, just helpers)
//   - Test files (`test/*.test.mts`)
//   - This hook itself (chicken-and-egg)
//
// Disable: `Allow new-hook bypass` in a recent user turn, or set
// SOCKET_NEW_HOOK_CLAUDE_MD_GUARD_DISABLED=1.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface PreToolUsePayload {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly file_path?: unknown } | undefined
  readonly transcript_path?: string | undefined
  readonly cwd?: string | undefined
}

const ENV_DISABLE = 'SOCKET_NEW_HOOK_CLAUDE_MD_GUARD_DISABLED'
const BYPASS_PHRASES = [
  'Allow new-hook bypass',
  'Allow new hook bypass',
  'Allow newhook bypass',
] as const

// Match either:
//   <repo>/template/.claude/hooks/<name>/index.mts    (wheelhouse)
//   <repo>/.claude/hooks/<name>/index.mts             (any fleet repo)
//
// Captures the hook name in group 1. The optional `template/` segment
// covers the wheelhouse path; the rest is identical.
const HOOK_INDEX_PATH_RE =
  /.*?(?:\/template)?\/\.claude\/hooks\/([^/]+)\/index\.mts$/

// Hooks that are themselves wheelhouse-only — they don't need a
// CLAUDE.md entry because they're internal tooling, not policy rules
// the fleet should know about. Update when adding more.
const WHEELHOUSE_ONLY_HOOKS: ReadonlySet<string> = new Set([
  'new-hook-claude-md-guard',
])

function findCanonicalClaudeMd(filePath: string, cwd: string | undefined): string | undefined {
  // Wheelhouse mode: `<repo>/template/.claude/hooks/<name>/index.mts`
  // → check `<repo>/template/CLAUDE.md` (the fleet-canonical source).
  const tplIdx = filePath.indexOf('/template/.claude/hooks/')
  if (tplIdx >= 0) {
    return filePath.slice(0, tplIdx) + '/template/CLAUDE.md'
  }
  // Downstream mode: `<repo>/.claude/hooks/<name>/index.mts`
  // → check `<repo>/CLAUDE.md` (the cascaded fleet block lives here).
  const repoIdx = filePath.indexOf('/.claude/hooks/')
  if (repoIdx >= 0) {
    return filePath.slice(0, repoIdx) + '/CLAUDE.md'
  }
  // Fallback: try cwd-relative. Prefer template/ if present, else
  // fall back to repo-root CLAUDE.md.
  if (cwd) {
    const tplCandidate = path.join(cwd, 'template', 'CLAUDE.md')
    if (existsSync(tplCandidate)) {
      return tplCandidate
    }
    const rootCandidate = path.join(cwd, 'CLAUDE.md')
    if (existsSync(rootCandidate)) {
      return rootCandidate
    }
  }
  return undefined
}

function readPayload(raw: string): PreToolUsePayload | undefined {
  try {
    return JSON.parse(raw) as PreToolUsePayload
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  if (process.env[ENV_DISABLE]) {
    process.exit(0)
  }
  const payloadRaw = await readStdin()
  const payload = readPayload(payloadRaw)
  if (!payload) {
    process.exit(0)
  }
  const toolName = payload.tool_name
  if (toolName !== 'Write' && toolName !== 'Edit') {
    process.exit(0)
  }
  const filePath = payload.tool_input?.['file_path']
  if (typeof filePath !== 'string') {
    process.exit(0)
  }
  const match = HOOK_INDEX_PATH_RE.exec(filePath)
  if (!match) {
    process.exit(0)
  }
  const hookName = match[1]!
  // Skip _shared (helpers, not a hook) and wheelhouse-only hooks.
  if (hookName === '_shared' || WHEELHOUSE_ONLY_HOOKS.has(hookName)) {
    process.exit(0)
  }
  // Bypass via canonical user phrase.
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    process.exit(0)
  }
  const claudeMdPath = findCanonicalClaudeMd(filePath, payload.cwd)
  if (!claudeMdPath || !existsSync(claudeMdPath)) {
    // Can't find CLAUDE.md; fail-open rather than blocking on
    // infrastructure problems.
    process.exit(0)
  }
  let content: string
  try {
    content = readFileSync(claudeMdPath, 'utf8')
  } catch {
    process.exit(0)
  }
  // The required form is `(enforced by `.claude/hooks/<hookName>/`)`.
  // We accept either backtick-quoted or plain-text variants of the
  // path — the existing fleet uses backticks consistently, but a
  // trailing slash is also optional.
  const expectedRefs = [
    `(enforced by \`.claude/hooks/${hookName}/\`)`,
    `(enforced by \`.claude/hooks/${hookName}\`)`,
    `enforced by \`.claude/hooks/${hookName}/\``,
    `enforced by \`.claude/hooks/${hookName}\``,
  ]
  let found = false
  for (let i = 0, { length } = expectedRefs; i < length; i += 1) {
    if (content.includes(expectedRefs[i]!)) {
      found = true
      break
    }
  }
  if (found) {
    process.exit(0)
  }

  const lines = [
    `[new-hook-claude-md-guard] Hook "${hookName}" missing CLAUDE.md reference.`,
    '',
    `  ${toolName} blocked: template/CLAUDE.md must contain a one-line`,
    `  reference to the hook before it lands. Expected form (inline,`,
    `  attached to the rule the hook enforces):`,
    '',
    `      (enforced by \`.claude/hooks/${hookName}/\`)`,
    '',
    '  Why: fleet repos read CLAUDE.md as the source of truth. A hook',
    '  without a CLAUDE.md entry is policy that doesn\'t exist on paper —',
    '  users won\'t know why they got blocked. Keep the entry minimal,',
    '  attached to an existing rule whenever possible.',
    '',
    '  Bypass (use sparingly, e.g. when adding the CLAUDE.md entry in',
    '  a follow-up commit on the same PR): type "Allow new-hook bypass"',
    '  in a recent message.',
    '',
  ]
  process.stderr.write(lines.join('\n') + '\n')
  process.exit(2)
}

main().catch(() => {
  process.exit(0)
})
