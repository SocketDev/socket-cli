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
// `@socketsecurity/lib/<subpath>`, `@socketsecurity/registry/<subpath>`,
// etc. Workspace deps are real, declared, and work regardless of clone
// layout.
//
// Exit code 2 makes Claude Code refuse the edit so the diff never
// lands. Doc lines that legitimately need to mention a path can carry
// the canonical opt-out marker `// socket-hook: allow cross-repo`
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

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const FLEET_REPO_NAMES = [
  'claude-code',
  'skills',
  'socket-addon',
  'socket-btm',
  'socket-cli',
  'socket-lib',
  'socket-packageurl-js',
  'socket-registry',
  'socket-wheelhouse',
  'socket-sdk-js',
  'socket-sdxgen',
  'socket-stuie',
  'ultrathink',
  'vscode-socket-security',
] as const

const FLEET_RE_FRAGMENT = FLEET_REPO_NAMES.join('|')

// `../<repo>/…` and deeper variants like `../../<repo>/…`. Boundary
// chars in front prevent matching e.g. `socketdev-../socket-cli/`.
const CROSS_REPO_RELATIVE_RE = new RegExp(
  String.raw`(?:^|[\s'"\`(=,])\.\.(?:/\.\.)*/(?:${FLEET_RE_FRAGMENT})\b`,
)
// `…/projects/<repo>/…` — absolute or env-rooted variant.
const CROSS_REPO_ABSOLUTE_RE = new RegExp(
  String.raw`/projects/(?:${FLEET_RE_FRAGMENT})\b`,
)
const CROSS_REPO_ANY_RE = new RegExp(
  `${CROSS_REPO_RELATIVE_RE.source}|${CROSS_REPO_ABSOLUTE_RE.source}`,
)

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

const SOCKET_HOOK_MARKER_RE =
  /(?:#|\/\/|\/\*)\s*socket-hook:\s*allow(?:\s+([\w-]+))?/

function isMarkerSuppressed(line: string): boolean {
  const m = line.match(SOCKET_HOOK_MARKER_RE)
  if (!m) {
    return false
  }
  return !m[1] || m[1] === 'cross-repo'
}

function isInScope(filePath: string): boolean {
  if (!filePath) {
    return false
  }
  for (const re of EXEMPT_PATH_PATTERNS) {
    if (re.test(filePath)) {
      return false
    }
  }
  return true
}

function repoNameFromPath(filePath: string): string | undefined {
  // `/Users/<user>/projects/socket-lib/src/foo.ts` → `socket-lib`.
  // Best-effort: take the segment after `/projects/` if present.
  const m = filePath.match(/\/projects\/([^/]+)/)
  return m?.[1]
}

interface Hit {
  lineNumber: number
  line: string
  matched: string
}

function scan(source: string, currentRepoName?: string): Hit[] {
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
    if (isMarkerSuppressed(line)) {
      continue
    }
    hits.push({ lineNumber: i + 1, line, matched })
  }
  return hits
}

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => (buf += chunk))
    process.stdin.on('end', () => resolve(buf))
  })
}

interface ToolInput {
  tool_name?: string
  tool_input?: {
    file_path?: string
    new_string?: string
    content?: string
  }
}

function emitBlock(filePath: string, hits: Hit[]): void {
  const lines: string[] = []
  lines.push('[cross-repo-guard] Blocked: cross-repo path reference found')
  lines.push(
    '  Use `@socketsecurity/lib/<subpath>` or `@socketsecurity/registry/<subpath>`',
  )
  lines.push(
    '  imports instead. Path-based references break in CI / fresh clones.',
  )
  lines.push(`  File:    ${filePath}`)
  for (const h of hits.slice(0, 3)) {
    lines.push(`  Line ${h.lineNumber}: ${h.line.trim()}`)
    lines.push(`  Match:           ${h.matched.trim()}`)
  }
  if (hits.length > 3) {
    lines.push(`  …and ${hits.length - 3} more.`)
  }
  lines.push(
    '  Opt-out for one line (rare): append `// socket-hook: allow cross-repo`.',
  )
  logger.error(lines.join('\n'))
}

async function main(): Promise<void> {
  const raw = await readStdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    return
  }
  const filePath = payload.tool_input?.file_path ?? ''
  if (!isInScope(filePath)) {
    return
  }
  const source =
    payload.tool_input?.new_string ?? payload.tool_input?.content ?? ''
  if (!source) {
    return
  }
  const hits = scan(source, repoNameFromPath(filePath))
  if (hits.length === 0) {
    return
  }
  emitBlock(filePath, hits)
  process.exitCode = 2
}

main().catch(e => {
  // Fail open on hook bugs.
  logger.error(
    `[cross-repo-guard] hook error (continuing): ${(e as Error).message}`,
  )
})
