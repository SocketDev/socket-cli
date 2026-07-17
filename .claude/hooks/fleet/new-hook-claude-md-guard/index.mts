#!/usr/bin/env node
// Claude Code PreToolUse hook — new-hook-claude-md-guard.
//
// Blocks Write/Edit operations that create or modify a hook's
// `index.mts` unless the relevant CLAUDE.md contains a backticked
// `(`.claude/hooks/<hook-name>/`)` citation (minimal form — no prose
// wrapper required).
//
// Two-mode behavior:
//
//   1. In socket-wheelhouse (path matches `template/base/.claude/hooks/`):
//      checks `template/base/CLAUDE.md` — the fleet-canonical source.
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
//   - Write to `<repo>/template/base/.claude/hooks/<name>/index.mts` (wheelhouse)
//   - Edit to `<repo>/template/base/.claude/hooks/<name>/index.mts` (wheelhouse)
//   - Write/Edit to `<repo>/.claude/hooks/<name>/index.mts` (any fleet repo)
//
// Skips:
//   - `_shared/` (not a hook, just helpers)
//   - Test files (`test/*.test.mts`)
//   - This hook itself (chicken-and-egg)
//
// Bypass: `Allow new-hook bypass` in a recent user turn.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

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
// (matches the parallel docs/agents.md/{fleet,repo}/ convention).
// hookName is the LEAF name (e.g. `avoid-cd-nudge`), not the
// segment-qualified path — citations and registry refs use the full
// canonical path (`\`.claude/hooks/fleet/<name>/\``) so the guard's
// expectedRefs uses that path verbatim when checking.
const HOOK_INDEX_PATH_RE =
  /.*?(?:\/template)?\/\.claude\/hooks\/(?:(fleet|repo)\/)?([^/]+)\/index\.mts$/

// Hooks that are themselves wheelhouse-only — they don't need a
// CLAUDE.md entry because they're internal tooling, not policy rules
// the fleet should know about. Update when adding more.
const WHEELHOUSE_ONLY_HOOKS: ReadonlySet<string> = new Set([
  'drift-check-nudge',
  'new-hook-claude-md-guard',
])

export function findCanonicalClaudeMd(
  filePath: string,
  cwd: string | undefined,
): string | undefined {
  const normalizedFilePath = normalizePath(filePath)
  // Wheelhouse mode: `<repo>/template/base/.claude/hooks/<name>/index.mts`
  // → check `<repo>/template/base/CLAUDE.md` (the fleet-canonical source).
  const tplIdx = normalizedFilePath.indexOf('/template/base/.claude/hooks/')
  if (tplIdx >= 0) {
    return normalizedFilePath.slice(0, tplIdx) + '/template/base/CLAUDE.md'
  }
  // Downstream mode: `<repo>/.claude/hooks/<name>/index.mts`
  // → check `<repo>/CLAUDE.md` (the cascaded fleet block lives here).
  const repoIdx = normalizedFilePath.indexOf('/.claude/hooks/')
  if (repoIdx >= 0) {
    return normalizedFilePath.slice(0, repoIdx) + '/CLAUDE.md'
  }
  // Fallback: try cwd-relative. Prefer template/ if present, else
  // fall back to repo-root CLAUDE.md.
  if (cwd) {
    const tplCandidate = path.join(cwd, 'template', 'base', 'CLAUDE.md')
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

export const check = editGuard((filePath, _content, payload) => {
  const toolName = payload.tool_name
  const normalizedFilePath = normalizePath(filePath)
  const match = HOOK_INDEX_PATH_RE.exec(normalizedFilePath)
  if (!match) {
    return undefined
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
    return undefined
  }
  // Per-repo hooks at `.claude/hooks/repo/<name>/` are NOT cascaded
  // and live entirely in the host repo. Skip the CLAUDE.md citation
  // requirement — repo hooks document themselves in their own README
  // + the host repo's CLAUDE.md decides whether to cite them.
  if (segment === 'repo') {
    return undefined
  }
  // Bypass via canonical user phrase.
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    return undefined
  }
  const claudeMdPath = findCanonicalClaudeMd(normalizedFilePath, payload.cwd)
  if (!claudeMdPath || !existsSync(claudeMdPath)) {
    // Can't find CLAUDE.md; fail-open rather than blocking on
    // infrastructure problems.
    return undefined
  }
  let content: string
  try {
    content = readFileSync(claudeMdPath, 'utf8')
  } catch {
    return undefined
  }
  // Three citation shapes recognized (the backticked path is the citation —
  // no prose wrapper required; minimal `(\`.claude/hooks/fleet/<name>/\`)` is
  // the canonical form):
  //   1. Inline rule:    `(\`.claude/hooks/fleet/<name>/\`)`
  //   2. Comma-listed:   `(\`.claude/hooks/fleet/a/\`, \`.../b/\`)`
  //   3. Brace-grouped:  `(\`.claude/hooks/fleet/{a,b,c}/\`)`
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
  const citedIn = (text: string): boolean =>
    text.includes(literalSlashed) ||
    text.includes(literalBare) ||
    braceRe.test(text)

  // A citation in the linked hook-registry doc counts too. CLAUDE.md is
  // size-capped (claude-md-size-guard), so the registry — which CLAUDE.md's
  // `### Hook registry` section explicitly points at as the "full listing"
  // — is the canonical low-cost home for per-hook associations. The registry
  // lists each fleet hook as a `- \`<leaf>\` — description` bullet, so a
  // backticked leaf there satisfies the gate (in addition to the path forms).
  const registryPath = claudeMdPath.replace(
    /CLAUDE\.md$/,
    'docs/agents.md/fleet/hook-registry.md',
  )
  let registryCited = false
  if (registryPath !== claudeMdPath && existsSync(registryPath)) {
    try {
      const registry = readFileSync(registryPath, 'utf8')
      const bulletRe = new RegExp(`^\\s*-\\s*\`${escape(leaf)}\``, 'm')
      registryCited = citedIn(registry) || bulletRe.test(registry)
    } catch {
      // Registry unreadable — fall back to the CLAUDE.md result.
    }
  }

  if (citedIn(content) || registryCited) {
    return undefined
  }

  const lines = [
    `[new-hook-claude-md-guard] Hook "${hookPathSuffix}" missing its enforcement reference.`,
    '',
    `  ${toolName} blocked: the hook needs a one-line association before it`,
    '  lands, in EITHER place:',
    '',
    `    - the hook-registry doc (preferred — CLAUDE.md is size-capped):`,
    `        docs/agents.md/fleet/hook-registry.md, as a bullet:`,
    `          - \`${leaf}\` — <one-line description>`,
    `    - or inline in CLAUDE.md, attached to the rule it enforces:`,
    `          (\`.claude/hooks/${hookPathSuffix}/\`)`,
    '',
    '  Why: fleet repos read CLAUDE.md + its linked docs as the source of',
    "  truth. A hook with no entry is policy that doesn't exist on paper —",
    "  users won't know why they got blocked. Prefer the registry bullet;",
    '  it keeps CLAUDE.md under the 40 KB cap.',
    '',
    '  Bypass (use sparingly, e.g. when adding the entry in a follow-up',
    '  commit on the same PR): type "Allow new-hook bypass" in a recent',
    '  message.',
    '',
  ]
  return block(lines.join('\n') + '\n')
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
