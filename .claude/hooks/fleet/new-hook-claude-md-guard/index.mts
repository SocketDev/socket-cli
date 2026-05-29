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
  readonly tool_input?: { readonly file_path?: unknown | undefined } | undefined
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
// covers the wheelhouse path; the optional `fleet/` or `repo/` segment
// covers the docs-style `.claude/hooks/{fleet,repo}/<name>/` layout
// (matches the parallel docs/claude.md/{fleet,repo}/ convention).
// hookName is the LEAF name (e.g. `avoid-cd-reminder`), not the
// segment-qualified path — citations and registry refs use the full
// canonical path (`\`.claude/hooks/fleet/<name>/\``) so the guard's
// expectedRefs uses that path verbatim when checking.
const HOOK_INDEX_PATH_RE =
  /.*?(?:\/template)?\/\.claude\/hooks\/(?:(fleet|repo)\/)?([^/]+)\/index\.mts$/

// Hooks that are themselves wheelhouse-only — they don't need a
// CLAUDE.md entry because they're internal tooling, not policy rules
// the fleet should know about. Update when adding more.
const WHEELHOUSE_ONLY_HOOKS: ReadonlySet<string> = new Set([
  'new-hook-claude-md-guard',
])

export function findCanonicalClaudeMd(
  filePath: string,
  cwd: string | undefined,
): string | undefined {
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

export function readPayload(raw: string): PreToolUsePayload | undefined {
  try {
    return JSON.parse(raw) as PreToolUsePayload
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  if (process.env[ENV_DISABLE]) {
    return
  }
  const payloadRaw = await readStdin()
  const payload = readPayload(payloadRaw)
  if (!payload) {
    return
  }
  const toolName = payload.tool_name
  if (toolName !== 'Edit' && toolName !== 'Write') {
    return
  }
  const filePath = payload.tool_input?.['file_path']
  if (typeof filePath !== 'string') {
    return
  }
  const match = HOOK_INDEX_PATH_RE.exec(filePath)
  if (!match) {
    return
  }
  // match[1] = "fleet" | "repo" | undefined (legacy top-level layout).
  // match[2] = leaf hook name.
  const segment = match[1]
  const hookName = match[2]!
  // hookPathSuffix is the canonical path under .claude/hooks/, used
  // verbatim in CLAUDE.md citations:
  //   fleet  →  `fleet/<name>`
  //   repo   →  `repo/<name>`  (per-repo, normally exempt — see below)
  //   (none) →  `<name>`        (legacy top-level)
  const hookPathSuffix = segment ? `${segment}/${hookName}` : hookName
  // Skip _shared (helpers, not a hook) and wheelhouse-only hooks.
  if (hookName === '_shared' || WHEELHOUSE_ONLY_HOOKS.has(hookName)) {
    return
  }
  // Per-repo hooks at `.claude/hooks/repo/<name>/` are NOT cascaded
  // and live entirely in the host repo. Skip the CLAUDE.md citation
  // requirement — repo hooks document themselves in their own README
  // + the host repo's CLAUDE.md decides whether to cite them.
  if (segment === 'repo') {
    return
  }
  // Bypass via canonical user phrase.
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    return
  }
  const claudeMdPath = findCanonicalClaudeMd(filePath, payload.cwd)
  if (!claudeMdPath || !existsSync(claudeMdPath)) {
    // Can't find CLAUDE.md; fail-open rather than blocking on
    // infrastructure problems.
    return
  }
  let content: string
  try {
    content = readFileSync(claudeMdPath, 'utf8')
  } catch {
    return
  }
  // Three citation shapes recognized:
  //   1. Inline rule:    `enforced by \`.claude/hooks/fleet/<name>/\``
  //   2. Comma-listed:   `enforced by \`.claude/hooks/fleet/a/\`, \`.../b/\``
  //   3. Brace-grouped:  `enforced by \`.claude/hooks/fleet/{a,b,c}/\``
  // 1+2 contain the literal backticked path; 3 is a brace expansion
  // — the leaf name appears between `{...}`.
  const literalSlashed = `\`.claude/hooks/${hookPathSuffix}/\``
  const literalBare = `\`.claude/hooks/${hookPathSuffix}\``
  const lastSlash = hookPathSuffix.lastIndexOf('/')
  const prefix = lastSlash >= 0 ? hookPathSuffix.slice(0, lastSlash + 1) : ''
  const leaf =
    lastSlash >= 0 ? hookPathSuffix.slice(lastSlash + 1) : hookPathSuffix
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const braceRe = new RegExp(
    `\`\\.claude/hooks/${escape(prefix)}\\{[^}]*\\b${escape(leaf)}\\b[^}]*\\}/\``,
  )
  const found =
    content.includes(literalSlashed) ||
    content.includes(literalBare) ||
    braceRe.test(content)
  if (found) {
    return
  }

  const lines = [
    `[new-hook-claude-md-guard] Hook "${hookPathSuffix}" missing CLAUDE.md reference.`,
    '',
    `  ${toolName} blocked: template/CLAUDE.md must contain a one-line`,
    `  reference to the hook before it lands. Expected form (inline,`,
    `  attached to the rule the hook enforces):`,
    '',
    `      (enforced by \`.claude/hooks/${hookPathSuffix}/\`)`,
    '',
    '  Why: fleet repos read CLAUDE.md as the source of truth. A hook',
    "  without a CLAUDE.md entry is policy that doesn't exist on paper —",
    "  users won't know why they got blocked. Keep the entry minimal,",
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
  // Fail-open: never block a session on this hook's own bug.
  // Loop drains naturally to exit 0; explicit set for clarity.
  process.exitCode = 0
})
