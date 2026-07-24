#!/usr/bin/env node
// Claude Code PreToolUse hook — cross-repo guard.
//
// Blocks Edit/Write tool calls that would introduce a path reference
// to another fleet repo. Two forbidden forms:
//
//   1. `../<fleet-repo>/…`  — relative path that escapes the current
//                            repo into a sibling clone. Hardcodes the
//                            assumption that both repos live as
//                            siblings under the same projects root;
//                            breaks in CI / fresh clones / non-
//                            standard layouts.
//   2. `…/projects/<fleet-repo>/…`  — absolute or env-rooted path
//                                    that targets another fleet
//                                    repo. Same brittleness, plus
//                                    leaks the author's directory
//                                    layout into source.
//
// The right form is to import via the published npm package:
// `@socketsecurity/lib-stable/<subpath>`, `@socketsecurity/registry-stable/<subpath>`,
// etc. Workspace deps are real, declared, and work regardless of clone
// layout.
//
// Exit code 2 makes Claude Code refuse the edit so the diff never
// lands. Doc lines that legitimately need to mention a path can carry
// the canonical opt-out marker `// socket-lint: allow cross-repo`
// (`#`/`/*` accepted).
//
// Scope:
//   - Fires only on `Edit` and `Write` tool calls.
//   - Inspects all text-shaped file extensions; fleet-repo names in
//     pnpm-lock.yaml / pnpm-workspace.yaml / CLAUDE.md / .gitmodules /
//     this hook itself are exempt by path.
//
// Fails open on hook bugs (exit code 0 + logger.error).
//
// Companion to the git-side `scanCrossRepoPaths` scanner in
// `.git-hooks/_helpers.mts` — same regex shape, same semantics. Keep
// the two regexes in sync.

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { lineIsSuppressed } from '../_shared/markers.mts'
// CROSS_REPO_ANY_RE (built from the canonical FLEET_REPO_NAMES roster) is
// imported from the gate-free cross-tree _shared/cross-repo.mts — the SAME
// regex the commit-time scanCrossRepoPaths uses, so the two can't drift (was
// a duplicated inline copy here).
import {
  CROSS_REPO_ANY_RE,
  relativeTokenEscapesRepo,
  repoNameForFile,
} from '../../../../.git-hooks/_shared/cross-repo.mts'

// Files exempt from the rule. Comments explain why each is excluded.
const EXEMPT_PATH_PATTERNS: RegExp[] = [
  // The hook itself names every fleet repo by necessity.
  /\.claude\/hooks\/cross-repo-guard\//,
  // The git-side scanner does the same.
  /\.git-hooks\/_helpers\.mts$/,
  // The fleet's canonical CLAUDE.md documents fleet repo relationships.
  /(?:^|\/)CLAUDE\.md$/,
  // Submodule index — fleet repos point at each other by URL.
  /(?:^|\/)\.gitmodules$/,
  // Lockfiles / workspace config name fleet packages.
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)pnpm-workspace\.yaml$/,
  // Memory files in `.claude/projects/...` may legitimately quote past
  // mistakes verbatim.
  /\.claude\/projects\/.*\/memory\//,
]

export function emitBlock(filePath: string, hits: Hit[]): string {
  const lines: string[] = []
  lines.push('[cross-repo-guard] Blocked: cross-repo path reference found')
  lines.push(
    '  Use `@socketsecurity/lib-stable/<subpath>` or `@socketsecurity/registry-stable/<subpath>`',
  )
  lines.push(
    '  imports instead. Path-based references break in CI / fresh clones.',
  )
  lines.push(`  File:    ${filePath}`)
  const hs = hits.slice(0, 3)
  for (let i = 0, { length } = hs; i < length; i += 1) {
    const h = hs[i]!
    lines.push(`  Line ${h.lineNumber}: ${h.line.trim()}`)
    lines.push(`  Match:           ${h.matched.trim()}`)
  }
  if (hits.length > 3) {
    lines.push(`  …and ${hits.length - 3} more.`)
  }
  lines.push(
    '  Opt-out for one line (rare): append `// socket-lint: allow cross-repo`.',
  )
  return lines.join('\n')
}

export function isInScope(filePath: string): boolean {
  if (!filePath) {
    return false
  }
  for (let i = 0, { length } = EXEMPT_PATH_PATTERNS; i < length; i += 1) {
    const re = EXEMPT_PATH_PATTERNS[i]!
    if (re.test(filePath)) {
      return false
    }
  }
  return true
}

interface Hit {
  lineNumber: number
  line: string
  matched: string
}

export function scan(source: string, fileAbsPath: string): Hit[] {
  const currentRepoName = repoNameForFile(fileAbsPath)
  const hits: Hit[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const m = line.match(CROSS_REPO_ANY_RE)
    if (!m) {
      continue
    }
    // A repo's own paths are fine — only flag escapes.
    const matched = m[0]
    if (currentRepoName && matched.includes(`/${currentRepoName}`)) {
      continue
    }
    // A relative `..`-traversal that resolves back INSIDE this repo (e.g. an
    // intra-repo `.claude/skills/` import, whose `skills` segment collides with
    // the `skills` fleet-repo name) is not a cross-repo escape.
    if (
      fileAbsPath &&
      matched.includes('..') &&
      !relativeTokenEscapesRepo(matched, fileAbsPath)
    ) {
      continue
    }
    if (lineIsSuppressed(line, 'cross-repo')) {
      continue
    }
    hits.push({ lineNumber: i + 1, line, matched })
  }
  return hits
}

export const check = editGuard((filePath, content) => {
  if (!isInScope(filePath)) {
    return undefined
  }
  const source = content ?? ''
  if (!source) {
    return undefined
  }
  const hits = scan(source, filePath)
  if (hits.length === 0) {
    return undefined
  }
  return block(emitBlock(filePath, hits))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
