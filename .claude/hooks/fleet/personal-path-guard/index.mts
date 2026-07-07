#!/usr/bin/env node
// Claude Code PreToolUse hook — personal-path-guard.
//
// Edit-time twin of the commit-time `scanPersonalPaths` check
// (.git-hooks/fleet/pre-commit.mts → scanPersonalPaths in
// .git-hooks/_shared/helpers.mts). The commit-time scanner only fires
// once a leak is already on disk and staged; this hook blocks the
// Write/Edit BEFORE a hardcoded personal path lands, so the model
// fixes it in the same turn instead of discovering it at `git commit`.
//
// Blocks Edit/Write tool calls whose about-to-land content contains a
// real personal path — a hardcoded local USERNAME leak:
//
//   /Users/<name>/...      (macOS)
//   /home/<name>/...       (Linux)
//   C:\Users\<name>\...    (Windows)
//
// Username-free forms are the OPPOSITE of a leak and are NOT flagged:
// `~/...`, `$HOME/...`, and the canonical placeholders
// `/Users/<user>/`, `/home/<user>/`, `C:\Users\<USERNAME>\`.
//
// Exit codes:
//   0  — allow.
//   2  — block. Stderr carries the operator-facing fix.
//
// Fails OPEN on any internal error (exit 0 + stderr log) so a bad hook
// deploy can't wedge the session.

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { lineIsSuppressed } from '../_shared/markers.mts'
// Personal-path matcher imported from the gate-free cross-tree shared module —
// the SAME regexes + filter + rewrite the commit-time scanPersonalPaths uses,
// so the two surfaces can't drift (was a lock-step inline copy).
import {
  isPurePlaceholder,
  PERSONAL_PATH_RE,
  suggestPlaceholder,
} from '../../../../.git-hooks/_shared/personal-path.mts'

// Only inspect text files where a hardcoded local path is a real leak.
// Lockfiles, vendored, and node_modules trees legitimately carry
// absolute paths and are not author-written source.
const EXEMPT_PATH_PATTERNS: RegExp[] = [
  /(?:^|\/)node_modules\//,
  /(?:^|\/)vendor\//,
  /(?:^|\/)upstream\//,
  /(?:^|\/)external\//,
  /(?:^|\/)third_party\//,
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/,
]

export interface PersonalPathHit {
  line: number
  text: string
  suggested: string
}

export function isInScope(filePath: string): boolean {
  if (!filePath) {
    return false
  }
  for (let i = 0, { length } = EXEMPT_PATH_PATTERNS; i < length; i += 1) {
    if (EXEMPT_PATH_PATTERNS[i]!.test(filePath)) {
      return false
    }
  }
  return true
}

export function scanPersonalPaths(content: string): PersonalPathHit[] {
  const hits: PersonalPathHit[] = []
  // CRLF-tolerant split — a trailing \r would break the regex anchors
  // and let a leak slip past on Windows-authored content.
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    // NFKC-normalize before match — catches full-width / ligature
    // variants of `/Users` that would slip past the ASCII-only regex.
    const line = raw.normalize('NFKC')
    if (!PERSONAL_PATH_RE.test(line)) {
      continue
    }
    if (isPurePlaceholder(line)) {
      continue
    }
    // Per-line opt-out: `// socket-lint: allow personal-path` — the same
    // marker the commit-time scanner honors via skipDocs.
    if (lineIsSuppressed(line, 'personal-path')) {
      continue
    }
    hits.push({
      line: i + 1,
      text: raw.trim(),
      suggested: suggestPlaceholder(raw).trim(),
    })
  }
  return hits
}

export function formatBlockMessage(
  filePath: string,
  hits: PersonalPathHit[],
): string {
  const out: string[] = []
  out.push('')
  out.push('[personal-path-guard] Blocked: hardcoded personal path found')
  out.push(`  File:    ${filePath}`)
  for (const h of hits.slice(0, 3)) {
    out.push(`  Line ${h.line}: ${h.text}`)
    if (h.suggested && h.suggested !== h.text) {
      out.push(`  Fix:           ${h.suggested}`)
    }
  }
  if (hits.length > 3) {
    out.push(`  …and ${hits.length - 3} more.`)
  }
  out.push('  Replace with the canonical placeholder for the path platform:')
  out.push(
    '    /Users/<user>/...  (macOS)   /home/<user>/...  (Linux)   C:\\Users\\<USERNAME>\\...  (Windows)',
  )
  out.push('  Env vars also work: `$HOME`, `${USER}`, `~/`.')
  out.push(
    '  For a line that must keep the literal form, append `// socket-lint: allow personal-path`.',
  )
  out.push('')
  return out.join('\n')
}

export const hook = defineHook({
  check: editGuard((filePath, content) => {
    if (!isInScope(filePath)) {
      return undefined
    }
    const source = content ?? ''
    if (!source) {
      return undefined
    }
    const hits = scanPersonalPaths(source)
    if (hits.length === 0) {
      return undefined
    }
    return block(formatBlockMessage(filePath, hits))
  }),
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
