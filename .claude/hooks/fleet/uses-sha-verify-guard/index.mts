#!/usr/bin/env node
// Claude Code PreToolUse hook — uses-sha-verify-guard.
//
// Every GitHub URL pin in fleet repos needs a full 40-char SHA that
// resolves in the referenced repo. Blocks Edit/Write tool calls that
// introduce SHA pins that are:
//   1. Truncated (less than 40 hex chars for commit SHAs; less than
//      64 hex chars for content-hash sha256: pins).
//   2. Not actually hex (version tags like `v1.2.3`, branch names
//      like `main`, partial SHAs).
//   3. Real-length but not reachable in the referenced repo (via
//      `gh api repos/<owner>/<repo>/commits/<sha>`).
//   4. Missing from a `.gitmodules` submodule block (BOTH the
//      `# <name>-<version> sha256:<64hex>` comment AND the
//      `ref = <40hex>` field are required).
//
// Three surfaces:
//
// A. `.github/workflows/*.yml` + `.github/actions/*/action.yml`:
//    Every `uses: <owner>/<repo>(?:/<path>)?@<ref>` must have a full
//    40-char hex `<ref>` that resolves.
//
// B. `.gitmodules` at the repo root:
//    Every `[submodule "..."]` block MUST carry BOTH a
//    `# <name>-<version> sha256:<64hex>` header comment AND a
//    `ref = <40hex>` field.
//
// C. `package.json`:
//    Every `git+https://github.com/<owner>/<repo>(?:\.git)?#<ref>`
//    dep specifier in `dependencies`, `devDependencies`,
//    `peerDependencies`, `optionalDependencies`, `overrides`, or
//    `resolutions` must have a full 40-char hex `<ref>`.
//
// Companion to `gitmodules-comment-guard` (which enforces the
// `# <name>-<version>` shape but not SHA validity). Caching via
// `~/.claude/uses-sha-verify-cache.json` keyed by `<repo>@<sha>`
// with a 7-day TTL.
//
// Bypass: `Allow uses-sha-verify bypass`.
//
// Exits:
//   0 — allowed (not a tracked file, all SHAs verify, OR bypass).
//   2 — blocked (stderr explains which pin failed + how to fix).
//   0 (with stderr log) — fail-open on hook bugs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow uses-sha-verify bypass'

const CACHE_FILE = path.join(
  os.homedir(),
  '.claude',
  'uses-sha-verify-cache.json',
)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface Hook {
  tool_name?: string | undefined
  tool_input?:
    | {
        file_path?: string | undefined
        new_string?: string | undefined
        content?: string | undefined
      }
    | undefined
  transcript_path?: string | undefined
}

interface CacheEntry {
  reachable: boolean
  checkedAt: number
}

interface Cache {
  entries: Record<string, CacheEntry>
}

function loadCache(): Cache {
  if (!existsSync(CACHE_FILE)) {
    return { entries: {} }
  }
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) {
      return { entries: {} }
    }
    return parsed
  } catch {
    return { entries: {} }
  }
}

function saveCache(cache: Cache): void {
  try {
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8')
  } catch {
    // best-effort
  }
}

// Verify a commit SHA against `gh api repos/<owner>/<repo>/commits/<sha>`.
// Cached for 7 days; a previously-reachable SHA stays reachable.
export function verifyCommitSha(
  ownerRepo: string,
  sha: string,
  cache: Cache,
): boolean {
  const key = `${ownerRepo}@${sha}`
  const entry = cache.entries[key]
  if (entry && Date.now() - entry.checkedAt < CACHE_TTL_MS) {
    return entry.reachable
  }
  const result = spawnSync(
    'gh',
    ['api', `repos/${ownerRepo}/commits/${sha}`, '--silent'],
    { stdio: 'ignore', timeout: 5000 },
  )
  const reachable = result.status === 0
  cache.entries[key] = { reachable, checkedAt: Date.now() }
  return reachable
}

// Match `uses: <owner>/<repo>(/<path>)?@<ref>`. Tolerates leading
// whitespace, list dash (`- uses:`), and trailing comments.
const USES_RE =
  /^\s*(?:-\s+)?uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?)@([^\s#]+)/

// Match `# <name>-<version> sha256:<hex>` header.
const GITMODULES_HEADER_RE =
  /^#\s+[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?-[^\s]+\s+sha256:([0-9a-f]+)/

// Match `ref = <hex>` inside a submodule block.
const GITMODULES_REF_RE = /^\s*ref\s*=\s*([0-9a-f]+)\s*$/

// Match `[submodule "PATH"]`.
const SUBMODULE_OPEN_RE = /^\s*\[submodule\s+"([^"]+)"\s*\]\s*$/

// Match `git+https://github.com/<owner>/<repo>(.git)?#<ref>` in JSON.
// Captures owner/repo and ref. Tolerates quoting around the URL value.
const PACKAGE_JSON_GITHUB_RE =
  /git\+https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?#([^"]+)/g

interface UsesIssue {
  line: number
  raw: string
  problem: string
}

export function findUsesIssues(content: string, cache: Cache): UsesIssue[] {
  const issues: UsesIssue[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const m = USES_RE.exec(line)
    if (!m) {
      continue
    }
    const ownerRepoPath = m[1]!
    const ref = m[2]!
    const ownerRepo = ownerRepoPath.split('/').slice(0, 2).join('/')
    if (!/^[0-9a-f]{40}$/i.test(ref)) {
      issues.push({
        line: i + 1,
        raw: line.trim(),
        problem: /^[0-9a-f]+$/i.test(ref)
          ? `truncated SHA (${ref.length} hex chars, need exactly 40)`
          : `not a SHA pin (got "${ref}"; fleet requires full 40-char hex)`,
      })
      continue
    }
    if (!verifyCommitSha(ownerRepo, ref, cache)) {
      issues.push({
        line: i + 1,
        raw: line.trim(),
        problem: `SHA ${ref.slice(0, 10)}… not reachable in ${ownerRepo} (gh api 404). Either the SHA was mistyped or the repo is private and gh isn't authed for it.`,
      })
    }
  }
  return issues
}

interface SubmoduleIssue {
  submodule: string
  line: number
  problem: string
}

export function findGitmodulesIssues(content: string): SubmoduleIssue[] {
  const issues: SubmoduleIssue[] = []
  const lines = content.split('\n')

  interface Block {
    name: string
    startLine: number
    headerCommentSha: string | undefined
    refSha: string | undefined
  }
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const open = SUBMODULE_OPEN_RE.exec(line)
    if (!open) {
      continue
    }
    const name = open[1]!
    let headerSha: string | undefined
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = lines[j]!
      if (prev.trim() === '' || SUBMODULE_OPEN_RE.test(prev)) {
        break
      }
      const headerMatch = GITMODULES_HEADER_RE.exec(prev)
      if (headerMatch) {
        headerSha = headerMatch[1]
        break
      }
    }
    let refSha: string | undefined
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j]!
      if (/^\s*\[/.test(next)) {
        break
      }
      const refMatch = GITMODULES_REF_RE.exec(next)
      if (refMatch) {
        refSha = refMatch[1]
        break
      }
    }
    blocks.push({ name, startLine: i + 1, headerCommentSha: headerSha, refSha })
  }

  for (const block of blocks) {
    if (!block.headerCommentSha) {
      issues.push({
        submodule: block.name,
        line: block.startLine,
        problem:
          'missing `# <name>-<version> sha256:<64hex>` comment above the [submodule] block (content-hash pin required)',
      })
    } else if (!/^[0-9a-f]{64}$/.test(block.headerCommentSha)) {
      issues.push({
        submodule: block.name,
        line: block.startLine,
        problem: `header comment sha256 must be exactly 64 hex chars; got ${block.headerCommentSha.length}`,
      })
    }
    if (!block.refSha) {
      issues.push({
        submodule: block.name,
        line: block.startLine,
        problem:
          'missing `ref = <40hex>` field inside the [submodule] block (commit-SHA pin required)',
      })
    } else if (!/^[0-9a-f]{40}$/.test(block.refSha)) {
      issues.push({
        submodule: block.name,
        line: block.startLine,
        problem: `ref must be exactly 40 hex chars; got ${block.refSha.length}`,
      })
    }
  }
  return issues
}

interface PackageJsonIssue {
  ownerRepo: string
  ref: string
  problem: string
}

export function findPackageJsonIssues(
  content: string,
  cache: Cache,
): PackageJsonIssue[] {
  const issues: PackageJsonIssue[] = []
  PACKAGE_JSON_GITHUB_RE.lastIndex = 0
  let match: RegExpExecArray | null = PACKAGE_JSON_GITHUB_RE.exec(content)
  while (match) {
    const ownerRepo = match[1]!
    const ref = match[2]!
    if (!/^[0-9a-f]{40}$/i.test(ref)) {
      issues.push({
        ownerRepo,
        ref,
        problem: /^[0-9a-f]+$/i.test(ref)
          ? `truncated SHA (${ref.length} hex chars, need exactly 40)`
          : `not a SHA pin (got "${ref}"; fleet requires full 40-char hex)`,
      })
    } else if (!verifyCommitSha(ownerRepo, ref, cache)) {
      issues.push({
        ownerRepo,
        ref,
        problem: `SHA ${ref.slice(0, 10)}… not reachable in ${ownerRepo} (gh api 404).`,
      })
    }
    match = PACKAGE_JSON_GITHUB_RE.exec(content)
  }
  return issues
}

function readBodyFromPayload(payload: Hook): string {
  const ti = payload.tool_input
  if (!ti) {
    return ''
  }
  if (typeof ti.new_string === 'string') {
    return ti.new_string
  }
  if (typeof ti.content === 'string') {
    return ti.content
  }
  return ''
}

function isWorkflowOrActionPath(filePath: string): boolean {
  return (
    /\.github\/workflows\/[^/]+\.ya?ml$/.test(filePath) ||
    /\.github\/actions\/[^/]+\/action\.ya?ml$/.test(filePath)
  )
}

function isGitmodulesPath(filePath: string): boolean {
  return filePath.endsWith('/.gitmodules') || filePath === '.gitmodules'
}

function isPackageJsonPath(filePath: string): boolean {
  // Match repo-root package.json AND nested workspace package.json files.
  // Excludes node_modules paths.
  if (filePath.includes('/node_modules/')) {
    return false
  }
  return filePath.endsWith('/package.json') || filePath === 'package.json'
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: Hook
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    process.exit(0)
  }
  const toolName = payload.tool_name
  if (toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'MultiEdit') {
    process.exit(0)
  }
  const filePath = payload.tool_input?.file_path ?? ''
  if (!filePath) {
    process.exit(0)
  }
  const isUses = isWorkflowOrActionPath(filePath)
  const isGitmodules = isGitmodulesPath(filePath)
  const isPackageJson = isPackageJsonPath(filePath)
  if (!isUses && !isGitmodules && !isPackageJson) {
    process.exit(0)
  }

  const body = readBodyFromPayload(payload)
  if (!body) {
    process.exit(0)
  }

  const cache = loadCache()
  const usesIssues = isUses ? findUsesIssues(body, cache) : []
  const gitmodulesIssues = isGitmodules ? findGitmodulesIssues(body) : []
  const packageJsonIssues = isPackageJson
    ? findPackageJsonIssues(body, cache)
    : []
  saveCache(cache)

  if (
    usesIssues.length === 0 &&
    gitmodulesIssues.length === 0 &&
    packageJsonIssues.length === 0
  ) {
    process.exit(0)
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    process.exit(0)
  }

  const out: string[] = [
    'uses-sha-verify-guard: SHA pin verification failed',
    '',
  ]
  for (const issue of usesIssues) {
    out.push(`  ${filePath}:${issue.line}`)
    out.push(`    ${issue.raw}`)
    out.push(`    ↳ ${issue.problem}`)
    out.push('')
  }
  for (const issue of gitmodulesIssues) {
    out.push(`  ${filePath}:${issue.line} [submodule "${issue.submodule}"]`)
    out.push(`    ↳ ${issue.problem}`)
    out.push('')
  }
  for (const issue of packageJsonIssues) {
    out.push(
      `  ${filePath}: git+https://github.com/${issue.ownerRepo}#${issue.ref}`,
    )
    out.push(`    ↳ ${issue.problem}`)
    out.push('')
  }
  out.push('Fix the pin(s) above, or bypass with the canonical phrase:')
  out.push(`  ${BYPASS_PHRASE}`)
  process.stderr.write(`${out.join('\n')}\n`)
  process.exit(2)
}

main().catch(err => {
  // Fail-open on hook bugs.
  process.stderr.write(
    `uses-sha-verify-guard: hook crashed, failing open: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(0)
})
