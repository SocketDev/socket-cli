#!/usr/bin/env node
// Claude Code Stop hook — parallel-agent-removal-reminder.
//
// Fires at turn-end. Detects files THIS session previously READ that
// have since VANISHED or been MOVED on disk — without this session
// running `rm` / `git rm` / `safeDelete` / `unlink` on them. That
// asymmetry (I read it, I didn't delete it, it's gone) is the
// fingerprint of another Claude session sharing the same `.git/`
// removing or moving files mid-flight under us. Emits a loud stderr
// warning + pause-work instruction.
//
// Why this exists (incident 2026-06-04, socket-lib): a session re-read
// `src/paths/packages.ts` to add `findUpPackageJson`, found the file
// already contained the function (in a broken-imports, mid-flight
// state) because another agent had added it elsewhere. The existing
// parallel-agent-{edit-guard,staging-guard,on-stop-reminder} hooks
// covered Writes / git ops / Stop-time dirty paths but NOT the
// removal/move-of-read-files signal. This hook closes that gap.
//
// Heuristic:
//   1. Walk transcript JSONL, collect every `Read` `file_path` (and
//      Edit/Write — we touched them, so we'd notice). Resolve to
//      absolute paths.
//   2. For each, test if the path still exists on disk.
//   3. If missing: check that THIS session didn't do the removal. The
//      session "removed" a path if the transcript contains:
//        - a Bash command with `rm` / `git rm` / `safeDelete` /
//          `unlink` / `safeRm` and the path (or its dirname).
//        - an Edit/Write whose target replaced the file at that path
//          (rare — we'd see the new content via Write).
//   4. Survivors are foreign removals — list them.
//
// Combined with `listForeignDirtyPaths > 0` we escalate to a LOUD
// warning. With removals alone we still warn (a file we read is gone
// for a reason); the parallel-agent escalation language only fires when
// other foreign signals confirm it.
//
// Exit codes:
//   0 — always. Informational; never blocks.
//

import process from 'node:process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  listForeignDirtyPaths,
  readTouchedPaths,
} from '../_shared/foreign-paths.mts'
import { readStdin } from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

function getProjectDir(): string | undefined {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

/**
 * Collect every absolute path this session READ via the Read tool. Also
 * includes Edit / Write / NotebookEdit `file_path` since touching a file
 * implies awareness of its existence. Empty set on missing transcript.
 */
export function readSeenPaths(
  transcriptPath: string | undefined,
): Set<string> {
  const seen = new Set<string>()
  if (!transcriptPath) {
    return seen
  }
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return seen
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const msg = (entry as { message?: unknown }).message
    if (!msg || typeof msg !== 'object') {
      continue
    }
    const content = (msg as { content?: unknown }).content
    if (!Array.isArray(content)) {
      continue
    }
    for (let i = 0, { length } = content; i < length; i += 1) {
      const part = content[i]!
      if (!part || typeof part !== 'object') {
        continue
      }
      const toolName = (part as { name?: unknown }).name
      const toolInput = (part as { input?: unknown }).input
      if (
        typeof toolName !== 'string' ||
        !toolInput ||
        typeof toolInput !== 'object'
      ) {
        continue
      }
      if (
        toolName === 'Read' ||
        toolName === 'Edit' ||
        toolName === 'Write' ||
        toolName === 'NotebookEdit'
      ) {
        const filePath = (toolInput as { file_path?: unknown }).file_path
        if (typeof filePath === 'string' && filePath) {
          seen.add(path.resolve(filePath))
        }
      }
    }
  }
  return seen
}

/**
 * Collect absolute paths this session EXPLICITLY removed: any Bash command
 * mentioning `rm` / `git rm` / `safeDelete` / `unlink` / `safeRm`, paired with
 * a token that resolves to a path argument. Token-based, not parse-perfect —
 * the goal is to suppress false positives where we did the deletion ourselves,
 * so erring toward suppression is acceptable.
 */
export function readRemovedPaths(
  transcriptPath: string | undefined,
): Set<string> {
  const removed = new Set<string>()
  if (!transcriptPath) {
    return removed
  }
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return removed
  }
  const removalVerbs =
    /\b(?:rm|unlink|safeDelete|safeRm|safe-delete)\b|\bgit\s+rm\b|\bgit\s+mv\b/
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const msg = (entry as { message?: unknown }).message
    if (!msg || typeof msg !== 'object') {
      continue
    }
    const content = (msg as { content?: unknown }).content
    if (!Array.isArray(content)) {
      continue
    }
    for (let i = 0, { length } = content; i < length; i += 1) {
      const part = content[i]!
      if (!part || typeof part !== 'object') {
        continue
      }
      const toolName = (part as { name?: unknown }).name
      const toolInput = (part as { input?: unknown }).input
      if (
        toolName !== 'Bash' ||
        !toolInput ||
        typeof toolInput !== 'object'
      ) {
        continue
      }
      const command = (toolInput as { command?: unknown }).command
      if (typeof command !== 'string' || !removalVerbs.test(command)) {
        continue
      }
      for (const tok of command.split(/\s+/)) {
        if (!tok || tok.startsWith('-') || tok === '.') {
          continue
        }
        // Strip quotes & shell expansions before resolving.
        const cleaned = tok.replace(/^['"]|['"]$/g, '')
        if (!cleaned || cleaned.includes('$') || cleaned.includes('`')) {
          continue
        }
        try {
          removed.add(path.resolve(cleaned))
        } catch {
          continue
        }
      }
    }
  }
  return removed
}

/**
 * Paths the session previously read/edited that no longer exist on disk and
 * were not removed by this session. Returns repo-relative paths when
 * `repoDir` is provided, else absolute.
 */
export function findVanishedSeenPaths(
  seen: ReadonlySet<string>,
  removed: ReadonlySet<string>,
  repoDir: string,
): string[] {
  const out: string[] = []
  for (const abs of seen) {
    if (removed.has(abs)) {
      continue
    }
    // Suppress if the parent directory was removed (e.g. we rm -rf'd
    // the dir and the file was inside it).
    let parentRemoved = false
    let p = path.dirname(abs)
    while (p && p !== path.dirname(p)) {
      if (removed.has(p)) {
        parentRemoved = true
        break
      }
      p = path.dirname(p)
    }
    if (parentRemoved) {
      continue
    }
    if (existsSync(abs)) {
      continue
    }
    // Only report paths inside the repo — vanished /tmp/ scratch files
    // are usually intentional.
    const rel = path.relative(repoDir, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      continue
    }
    out.push(rel)
  }
  return out
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: StopPayload = {}
  try {
    payload = JSON.parse(raw) as StopPayload
  } catch {
    // Optional payload.
  }
  const repoDir = getProjectDir()
  if (!repoDir) {
    return
  }
  const seen = readSeenPaths(payload.transcript_path)
  if (seen.size === 0) {
    return
  }
  const removed = readRemovedPaths(payload.transcript_path)
  const vanished = findVanishedSeenPaths(seen, removed, repoDir)
  if (vanished.length === 0) {
    return
  }
  // Cross-check against listForeignDirtyPaths for escalation. If other
  // foreign signals confirm a parallel agent, we use loud language.
  const touched = readTouchedPaths(payload.transcript_path)
  const foreignDirty = listForeignDirtyPaths(repoDir, touched)
  const escalate = foreignDirty.length > 0

  const banner = escalate
    ? '⚠️  PARALLEL AGENT SUSPECTED — files you READ this session have vanished from disk:'
    : '[parallel-agent-removal-reminder] files this session previously read have vanished from disk:'
  process.stderr.write(`${banner}\n`)
  for (const p of vanished.slice(0, 10)) {
    process.stderr.write(`  ${p}\n`)
  }
  if (vanished.length > 10) {
    process.stderr.write(`  ... and ${vanished.length - 10} more\n`)
  }
  if (escalate) {
    process.stderr.write(
      `\n${foreignDirty.length} additional dirty path(s) not authored by this session — strong signal another Claude is on this checkout.\n` +
        '\n*** PAUSE WORK ***\n' +
        '  • Do NOT commit, revert, stash, or `git add -A`.\n' +
        '  • Run: git worktree list ; ps aux | grep -i claude\n' +
        '  • Run: git status ; git diff <vanished-path> (history may show the move)\n' +
        '  • Confer with the user before proceeding.\n' +
        '\nSee: CLAUDE.md → "Parallel Claude sessions"\n' +
        '     docs/claude.md/fleet/parallel-claude-sessions.md\n',
    )
  } else {
    process.stderr.write(
      '\nNo other foreign-dirty signals — most likely a deletion you did via a tool this hook does not track (build clean, test cleanup, etc.).\n' +
        'If you did NOT remove these, treat as a parallel-agent signal: pause + check `git worktree list`.\n',
    )
  }
}

main().catch(e => {
  process.stderr.write(
    `[parallel-agent-removal-reminder] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
  )
})
