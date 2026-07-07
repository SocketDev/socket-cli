// Bash surface — catches `sed`/`awk`/`echo`/`tee`/`cat`-heredoc shapes
// that rewrite SHA pins inside workflow/action/.gitmodules files
// without going through the Edit/Write tool. This is the gap that let
// a fabricated SHA suffix land in commit d6483ba4 (sed s|OLD|NEW|g).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { arrayUnique } from '@socketsecurity/lib-stable/arrays/unique'

import { verifyCommitSha } from './cache.mts'
import type { Cache } from './cache.mts'
import type { BareUsesScanResult, UsesIssue } from './issue-types.mts'
import {
  BARE_USES_RE_GLOBAL,
  BASH_GITMODULES_PATH_RE_GLOBAL,
  BASH_WORKFLOW_PATH_RE_GLOBAL,
  GITMODULES_URL_RE,
  LONE_SHA_RE_GLOBAL,
  USES_RE,
} from './regexes.mts'
import { validateRefReachable, validateRefShape } from './validate-ref.mts'

// Cap the Bash command we feed to BARE_USES_RE_GLOBAL — that regex
// has overlapping char classes ([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+) that
// backtrack quadratically against pathological input (80k chars ≈
// 9.8s in benchmark). Real Bash commands are kilobytes at most; this
// cap is a safety net, not a real-input bound.
const COMMAND_SCAN_CAP = 50_000

// Reject relPath captures that would escape the repo root via `..`
// segments. The BASH_WORKFLOW_PATH_RE_GLOBAL regex is prefix-anchored
// to `.github/` but the suffix `[^\s'")]+\.ya?ml` doesn't forbid `..`,
// so e.g. `.github/workflows/../../../../etc/passwd.yml` would match.
// We don't want the hook to be a file-existence oracle for arbitrary
// .yml-suffixed paths outside the cwd.
function isPathInsideCwd(relPath: string): boolean {
  const cwd = process.cwd()
  const resolved = path.resolve(cwd, relPath)
  // `path.relative` returns an empty string when paths are equal, a
  // relative path when the target is under cwd, and a path starting
  // with `..` when the target escapes. Rejecting any leading `..`
  // (or an absolute path on systems where path.relative bails) is
  // enough to block traversal.
  const rel = path.relative(cwd, resolved)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// Scan an arbitrary text blob (a Bash command, an inline shell-out) for
// `<owner>/<repo>(/<path>)?@<sha>` references and apply the same
// validation findUsesIssues uses for YAML — 40-char hex check + gh
// api reachability. Used only when the Bash command is targeting a
// workflow / action / .gitmodules path, so a stray `<repo>@<sha>` in
// unrelated commands doesn't trip the gate.
export function findBareUsesIssues(
  content: string,
  cache: Cache,
): BareUsesScanResult {
  const issues: UsesIssue[] = []
  const scannedShas = new Set<string>()
  // Cap the input we scan with BARE_USES_RE_GLOBAL — see COMMAND_SCAN_CAP
  // above. A pathological 80k-char command would otherwise hang the
  // hook for ~10s.
  const scanInput =
    content.length > COMMAND_SCAN_CAP
      ? content.slice(0, COMMAND_SCAN_CAP)
      : content
  let m: RegExpExecArray | null
  BARE_USES_RE_GLOBAL.lastIndex = 0
  while ((m = BARE_USES_RE_GLOBAL.exec(scanInput)) !== null) {
    const ownerRepoPath = m.groups!.ownerRepoPath!
    const ref = m.groups!.ref!
    const ownerRepo = ownerRepoPath.split('/').slice(0, 2).join('/')
    const shape = validateRefShape(ref)
    if (!shape.ok) {
      issues.push({ line: 0, raw: m[0]!, problem: shape.problem })
      continue
    }
    scannedShas.add(ref.toLowerCase())
    const reach = validateRefReachable(ownerRepo, ref, cache)
    if (!reach.ok) {
      issues.push({ line: 0, raw: m[0]!, problem: reach.problem })
    }
  }
  return { issues, scannedShas }
}

// Read the workflow / action file(s) the Bash command targets, extract
// every `uses: <owner>/<repo>(/<path>)?@<sha>` reference, and return
// the set of distinct owner/repo strings.
function targetWorkflowOwnerRepos(command: string): string[] {
  const ownerRepos = new Set<string>()
  BASH_WORKFLOW_PATH_RE_GLOBAL.lastIndex = 0
  let pm: RegExpExecArray | null
  while ((pm = BASH_WORKFLOW_PATH_RE_GLOBAL.exec(command)) !== null) {
    const relPath = pm.groups!.path!
    // Reject `..`-escape paths. The regex is prefix-anchored to
    // `.github/` but doesn't forbid `..` segments — without this
    // check, a Bash command could coerce the hook into reading any
    // .yml-shaped file on disk as a file-existence/timing oracle.
    if (!isPathInsideCwd(relPath)) {
      continue
    }
    // Resolve relative to cwd. We trust the cwd because the hook fires
    // inside Claude Code's session, and Bash commands run from the
    // session cwd. If the file doesn't exist (typo, generated path),
    // skip — we'll fail open on that lone SHA.
    let content: string
    try {
      content = readFileSync(relPath, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split('\n')) {
      const m = USES_RE.exec(line)
      if (!m) {
        continue
      }
      const ownerRepoPath = m.groups!.ownerRepoPath!
      const ownerRepo = ownerRepoPath.split('/').slice(0, 2).join('/')
      ownerRepos.add(ownerRepo)
    }
  }
  return Array.from(ownerRepos)
}

// Read the .gitmodules file(s) the Bash command targets, extract every
// `url = https://github.com/<owner>/<repo>` reference, and return the
// set of distinct owner/repo strings.
function targetGitmodulesOwnerRepos(command: string): string[] {
  const ownerRepos = new Set<string>()
  BASH_GITMODULES_PATH_RE_GLOBAL.lastIndex = 0
  let pm: RegExpExecArray | null
  while ((pm = BASH_GITMODULES_PATH_RE_GLOBAL.exec(command)) !== null) {
    const relPath = pm.groups!.path!
    if (!isPathInsideCwd(relPath)) {
      continue
    }
    let content: string
    try {
      content = readFileSync(relPath, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split('\n')) {
      const m = GITMODULES_URL_RE.exec(line)
      if (!m) {
        continue
      }
      ownerRepos.add(m.groups!.ownerRepo!)
    }
  }
  return Array.from(ownerRepos)
}

// For each lone 40-char SHA in the command, verify it resolves in AT
// LEAST one of the owner/repo strings extracted from the targeted
// workflow / action / .gitmodules file(s). If none of the candidates
// resolve, the SHA is either typo'd or fabricated — block.
export function findLoneShaIssues(
  command: string,
  cache: Cache,
  skipShas: Set<string> = new Set(),
): UsesIssue[] {
  const ownerRepos = arrayUnique([
    ...targetWorkflowOwnerRepos(command),
    ...targetGitmodulesOwnerRepos(command),
  ])
  if (ownerRepos.length === 0) {
    return []
  }
  const issues: UsesIssue[] = []
  const seen = new Set<string>()
  LONE_SHA_RE_GLOBAL.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LONE_SHA_RE_GLOBAL.exec(command)) !== null) {
    const sha = m.groups!.sha!.toLowerCase()
    if (seen.has(sha)) {
      continue
    }
    seen.add(sha)
    // Skip SHAs already verified by findBareUsesIssues — same SHA,
    // same gh api call, wasteful.
    if (skipShas.has(sha)) {
      continue
    }
    // Skip SHAs that are the OLD value of a sed substitution — the
    // user is replacing them, not introducing them. Detected by a
    // preceding `s|` (or `s/`, `s#`, `s~`) substitution opener
    // immediately before the SHA.
    const before = command.slice(Math.max(0, m.index - 6), m.index)
    if (/s[|/#~]$/.test(before)) {
      continue
    }
    const reachableSomewhere = ownerRepos.some(or =>
      verifyCommitSha(or, sha, cache),
    )
    if (!reachableSomewhere) {
      issues.push({
        line: 0,
        raw: sha,
        problem: `SHA ${sha.slice(0, 10)}… not reachable in any owner/repo referenced by the targeted workflow file(s): ${ownerRepos.join(', ')}`,
      })
    }
  }
  return issues
}
