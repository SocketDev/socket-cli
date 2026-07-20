#!/usr/bin/env node
// Claude Code PreToolUse + SessionStart hook — git-config-write-guard.
//
// Two modes:
//
// 1. **PreToolUse (Bash + Edit/Write)** — blocks writes to a fleet repo's
//    local `.git/config` that would clobber identity / signing / topology
//    keys. Detects:
//
//    Bash: `git config <key> <value>` (no --global/--system/--worktree
//    scope qualifier) where <key> ∈ BANNED_LOCAL_KEYS.
//
//    Edit/Write: file_path ending with `.git/config` whose new content
//    has a `[section]` then `key = value` shape matching one of the
//    banned keys.
//
// 2. **SessionStart** — scans every fleet repo under ~/projects/ for an
//    already-corrupted `.git/config` (bare = true, placeholder/test-fixture
//    identity leak, etc.) and reports them. Two findings AUTO-FIX (the rest
//    report for manual cleanup, never blocks):
//      - `core.bare = true` is unset (always wrong for a non-bare checkout;
//        breaks every git command).
//      - a PLACEHOLDER local `user.email` / `user.name`
//        (`*@example.com`, agent-ci, etc.) is unset WHEN a `--global`
//        identity exists to fall back to. A placeholder author email can't
//        be verified against the signing key on GitHub, so `required_signa-
//        tures` rejects the push, and the bad value was planted outside the
//        tool channel (an agent-CI container entrypoint), so the PreToolUse
//        write-block never saw it. Unsetting the local override lets the
//        signed global identity win. With NO global identity to fall back
//        to, it is reported (not unset) so the repo is not stranded with no
//        author.
//
// Bypass: `Allow git-config-write bypass` (single-use, for genuine
// operator scenarios — initial signing setup on a fresh checkout, etc.).
//
// Verdict: the PreToolUse path returns `block(message)` (runner exits 2) on a
// banned write, else `undefined` (allow). The SessionStart path is a
// side-effect (auto-fix + stdout report) that returns `undefined`.
//
// Full rationale + key table: docs/agents.md/fleet/git-config-write-guard.md

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { FLEET_REPO_NAMES } from '../_shared/fleet-repos.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardCheck, GuardResult } from '../_shared/guard.mts'
import {
  hasGlobalIdentity,
  PLACEHOLDER_EMAIL_PATTERNS,
} from '../_shared/git-identity.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow git-config-write bypass'

// Keys that must never live in a fleet repo's local `.git/config`.
// See docs/agents.md/fleet/git-config-write-guard.md for per-key
// rationale.
const BANNED_LOCAL_KEYS: readonly string[] = [
  'core.bare',
  'user.email',
  'user.name',
  'user.signingkey',
  'commit.gpgsign',
]

const BANNED_KEY_SET = new Set(BANNED_LOCAL_KEYS)

// ---------------------------------------------------------------------------
// PreToolUse: Bash detection
// ---------------------------------------------------------------------------

interface BannedHit {
  readonly key: string
  readonly value: string
}

/**
 * Parse a Bash command string for `git config <key> <value>` invocations that
 * would write a banned key at the local (non-global / non-system) scope.
 * Returns one Hit per matching invocation; an empty array means no block.
 *
 * Tolerates `&&`-chained commands, leading env-var assignments (`SOMETHING=x
 * git config ...`), and quoted values.
 *
 * Scope qualifiers that opt out: --global, --system, --worktree, --file <path>
 *
 * (--local is the default and is treated as the banned scope.)
 */
export function findBannedBashWrites(command: string): BannedHit[] {
  const hits: BannedHit[] = []
  // Split on common command separators (&& || ; |). This is a
  // structural-enough parse — false positives are fine (we just block
  // more), false negatives are not.
  const segments = command.split(/&&|\|\||;|\|/)
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!.trim()
    if (!segment) {
      continue
    }
    // Strip leading env-var assignments (`FOO=bar BAZ=qux git config ...`).
    const withoutEnv = segment.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/, '')
    // Match the leading `git config` invocation. Capture the rest of
    // the arguments so we can scan for the scope qualifier + key.
    const m = /^git\s+(?:-c\s+\S+\s+)*config\s+(.*)$/.exec(withoutEnv)
    if (!m) {
      continue
    }
    const args = m[1]!
    // Skip if --global / --system / --worktree / --file is present.
    if (/(?:^|\s)--(?:global|system|worktree|file)(?:\s|=|$)/.test(args)) {
      continue
    }
    // --local is explicit-default; still banned. Strip it so the key
    // extraction below works uniformly.
    const argsNoLocal = args.replace(/(?:^|\s)--local(?:\s|$)/, ' ').trim()
    // Skip read invocations (--get / --get-all / --get-regexp / --list / -l).
    if (
      /(?:^|\s)--(?:get|get-all|get-regexp|list)(?:\s|$)|(?:^|\s)-l(?:\s|$)/.test(
        argsNoLocal,
      )
    ) {
      continue
    }
    // Skip --unset (the rule is about WRITES, not removals — removing
    // a banned key is the correct cleanup).
    if (/(?:^|\s)--unset(?:\s|$)/.test(argsNoLocal)) {
      continue
    }
    // Extract <key> as the first non-flag token. Strip leading flags
    // like --add, --replace-all.
    const tokens = argsNoLocal.split(/\s+/).filter(t => !t.startsWith('-'))
    const key = tokens[0]
    const value = tokens.slice(1).join(' ')
    if (!key) {
      continue
    }
    if (BANNED_KEY_SET.has(key.toLowerCase())) {
      hits.push({ key: key.toLowerCase(), value })
    }
  }
  return hits
}

// ---------------------------------------------------------------------------
// PreToolUse: Edit/Write detection
// ---------------------------------------------------------------------------

/**
 * Scan a `.git/config` file body (the new content the user is about to write)
 * for banned key assignments. Parses the INI-shape: `[section]` then `key =
 * value` lines. Returns one Hit per banned key found.
 */
export function findBannedConfigWrites(content: string): BannedHit[] {
  const hits: BannedHit[] = []
  const lines = content.split('\n')
  let currentSection = ''
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const rawLine = lines[i]!
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) {
      continue
    }
    // Match a git config section header: `[core]` or `[branch "main"]`. Captures
    // the section name; the optional subsection (`"…"`) is consumed but not captured.
    const sectionMatch = /^\[([\w.-]+)(?:\s+"[^"]*")?\]$/.exec(line)
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.toLowerCase()
      continue
    }
    if (!currentSection) {
      continue
    }
    // Match a `key = value` assignment line. Captures the key (alphanumeric,
    // dots, hyphens) and the rest of the line as the value (may be empty).
    const kvMatch = /^([\w.-]+)\s*=\s*(.*)$/.exec(line)
    if (!kvMatch) {
      continue
    }
    const subkey = kvMatch[1]!.toLowerCase()
    const fullKey = `${currentSection}.${subkey}`
    if (BANNED_KEY_SET.has(fullKey)) {
      hits.push({ key: fullKey, value: kvMatch[2]! })
    }
  }
  return hits
}

// Decide whether a file path looks like a fleet repo's local .git/config.
// Anything ending in /.git/config qualifies. Worktree-specific configs
// (.git/worktrees/<name>/config) and ~/.gitconfig are excluded.
export function isLocalGitConfigPath(filePath: string): boolean {
  if (!filePath) {
    return false
  }
  // Worktree configs are scoped to the worktree only; allowed.
  if (/[/\\]worktrees[/\\]/.test(filePath)) {
    return false
  }
  // ~/.gitconfig is the global config; allowed.
  if (filePath.endsWith('.gitconfig')) {
    return false
  }
  return /[/\\]\.git[/\\]config$/.test(filePath)
}

// ---------------------------------------------------------------------------
// PreToolUse: shared block-message emitter
// ---------------------------------------------------------------------------

function buildBlockMessage(
  source: 'bash' | 'edit',
  hits: readonly BannedHit[],
  filePath?: string,
): string {
  const lines: string[] = []
  lines.push(
    '[git-config-write-guard] Blocked: write to banned local git config key.',
  )
  lines.push('')
  if (source === 'edit' && filePath) {
    lines.push(`  Path: ${filePath}`)
    lines.push('')
  }
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const h = hits[i]!
    lines.push(`  ${h.key.padEnd(20)} = ${h.value || '<unset value>'}`)
  }
  lines.push('')
  lines.push('  These keys are identity / signing / topology — they belong in')
  lines.push('  the GLOBAL git config (`git config --global <key> <value>`),')
  lines.push("  not a fleet repo's local `.git/config`. Past incident: a stray")
  lines.push('  `bare = true` in a local config bricked a repo for 3+ turns.')
  lines.push('')
  lines.push('  Fix:')
  lines.push('    1. Use --global instead: `git config --global user.email …`')
  lines.push('    2. Or scope to a worktree: `git config --worktree …`')
  lines.push('    3. Or, if cleaning up corruption, use `git config --unset`')
  lines.push('       to REMOVE the existing local override (allowed).')
  lines.push('')
  lines.push(`  Bypass: type "${BYPASS_PHRASE}" in your next message.`)
  lines.push('  Full spec: docs/agents.md/fleet/git-config-write-guard.md')
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// SessionStart: corruption probe
// ---------------------------------------------------------------------------

// Sentinel issue string for core.bare=true — the one corruption the probe
// auto-reverts (always wrong for a non-bare fleet checkout; safe to fix).
const BARE_ISSUE = 'core.bare = true (work tree treated as bare repo)'

// Sentinel for a placeholder local identity — auto-unset when a global
// identity exists (see restorePlaceholderIdentity).
const PLACEHOLDER_IDENTITY_ISSUE =
  'user.email is a non-verifiable placeholder (breaks signed-push verification)'

// The placeholder-email patterns + isPlaceholderEmail live in
// `_shared/git-identity.mts` (one source, shared with
// git-identity-drift-nudge). TEST_EMAIL_PATTERNS aliases them so the scan
// below reads unchanged.
const TEST_EMAIL_PATTERNS: readonly RegExp[] = PLACEHOLDER_EMAIL_PATTERNS

// Pull the `email = …` value out of a `[user]` section of a config body.
export function readConfigEmail(raw: string): string | undefined {
  // Find the [user] section, then the first email = value within it (until
  // the next [section]).
  const userBlock = /\[user\]([^[]*)/i.exec(raw)
  if (!userBlock) {
    return undefined
  }
  // Match `email = <value>` at the start of a line within the [user] block.
  // The leading `(?:^|\n)` anchors to line boundaries without consuming the newline
  // on a multiline string; captures the value after the `=`.
  const m = /(?:^|\n)\s*email\s*=\s*(.+)/i.exec(userBlock[1]!)
  return m ? m[1]!.trim() : undefined
}

interface CorruptionFinding {
  readonly repo: string
  readonly configPath: string
  readonly issues: readonly string[]
}

/**
 * Scan one repo's `.git/config` for known corruption shapes. Returns the issues
 * found (empty array means clean).
 */
export function scanRepoConfig(configPath: string): readonly string[] {
  if (!existsSync(configPath)) {
    return []
  }
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    return []
  }
  const issues: string[] = []
  // bare = true under [core] — ALWAYS wrong for a non-bare fleet checkout
  // (a worktree op can set it as a side effect; it then breaks `git add`/
  // `commit` with "must be run in a work tree" for any session on this `.git/`).
  // Unlike the identity/signing findings below, this is safe to revert
  // mechanically, so the caller auto-restores it.
  if (/\[core\][^[]*bare\s*=\s*true/i.test(raw)) {
    issues.push(BARE_ISSUE)
  }
  // Placeholder / test-fixture email leaks (test@example.com,
  // agent-ci@example.com, any *.example domain). Auto-unset later when a
  // global identity exists.
  for (let i = 0, { length } = TEST_EMAIL_PATTERNS; i < length; i += 1) {
    if (TEST_EMAIL_PATTERNS[i]!.test(raw)) {
      issues.push(PLACEHOLDER_IDENTITY_ISSUE)
      break
    }
  }
  // Test User name
  if (/name\s*=\s*Test\s+User/i.test(raw)) {
    issues.push('user.name = "Test User" (test-fixture identity leak)')
  }
  // commit.gpgsign = false (overrides global "must sign" preference)
  if (/\[commit\][^[]*gpgsign\s*=\s*false/i.test(raw)) {
    issues.push('commit.gpgsign = false (overrides global signing preference)')
  }
  return issues
}

/**
 * Probe every fleet repo under `~/projects/` for corruption. Returns the
 * findings list (empty when all clean).
 */
export function scanFleetRepos(
  projectsDir: string,
): readonly CorruptionFinding[] {
  if (!existsSync(projectsDir)) {
    return []
  }
  let entries: readonly string[]
  try {
    entries = readdirSync(projectsDir)
  } catch {
    return []
  }
  const findings: CorruptionFinding[] = []
  const fleetSet = new Set<string>(FLEET_REPO_NAMES)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const repo = entries[i]!
    if (!fleetSet.has(repo)) {
      continue
    }
    const repoPath = path.join(projectsDir, repo)
    try {
      if (!statSync(repoPath).isDirectory()) {
        continue
      }
    } catch {
      continue
    }
    const configPath = path.join(repoPath, '.git', 'config')
    const issues = scanRepoConfig(configPath)
    if (issues.length > 0) {
      findings.push({ repo, configPath, issues })
    }
  }
  return findings
}

/**
 * Revert `core.bare = true` in a fleet repo's local config by unsetting the key
 * (default is non-bare). Operates on the config FILE directly (`-f`), not
 * `--local`: with core.bare=true the checkout reads as bare, so `git config
 * --local` is refused ("must be run in a work tree"). Returns true if it acted.
 * core.bare=true on a non-bare checkout is never intentional, so — unlike the
 * identity/signing findings — this one is auto-fixed.
 */
export function restoreBareToFalse(configPath: string): boolean {
  const r = spawnSync(
    'git',
    ['config', '-f', configPath, '--unset', 'core.bare'],
    { encoding: 'utf8' },
  )
  return r.status === 0
}

/**
 * Unset a placeholder local `user.email` / `user.name` in a fleet repo's config
 * FILE so the signed global identity takes over. Operates on the file directly
 * (`-f`) to match restoreBareToFalse and to work even from an odd cwd. Only the
 * caller decides WHEN to invoke this (placeholder detected AND a global
 * identity exists); this just performs the unset. Returns true if it removed at
 * least one key. A missing key is a no-op (git exits non-zero for --unset of an
 * absent key, which we treat as "nothing to do" for that key).
 */
export function restorePlaceholderIdentity(configPath: string): boolean {
  let acted = false
  for (const key of ['user.email', 'user.name']) {
    const r = spawnSync('git', ['config', '-f', configPath, '--unset', key], {
      encoding: 'utf8',
    })
    if (r.status === 0) {
      acted = true
    }
  }
  return acted
}

function emitSessionStartReport(findings: readonly CorruptionFinding[]): void {
  if (findings.length === 0) {
    return
  }
  const lines: string[] = []
  lines.push(
    '[git-config-write-guard] Corruption detected in fleet repo local git configs:',
  )
  lines.push('')
  // A placeholder identity is auto-unset ONLY when a global identity exists
  // to fall back to. Probe once (it's the same global config for every repo).
  const globalIdentityExists = hasGlobalIdentity()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    lines.push(`  ${f.repo}`)
    lines.push(`    ${f.configPath}`)
    const restoredBare =
      f.issues.includes(BARE_ISSUE) && restoreBareToFalse(f.configPath)
    // Auto-unset a placeholder local identity when a global one underneath
    // can take over. Without a global fallback we leave it (reported) so the
    // repo isn't stranded with no author.
    /* c8 ignore start - globalIdentityExists false branch requires no global git config on the machine */
    const restoredIdentity =
      f.issues.includes(PLACEHOLDER_IDENTITY_ISSUE) &&
      globalIdentityExists &&
      restorePlaceholderIdentity(f.configPath)
    /* c8 ignore stop */
    for (let j = 0, jl = f.issues.length; j < jl; j += 1) {
      const issue = f.issues[j]!
      let suffix = ''
      if (issue === BARE_ISSUE && restoredBare) {
        suffix = ' — AUTO-RESTORED to non-bare'
      } else if (issue === PLACEHOLDER_IDENTITY_ISSUE) {
        /* c8 ignore next - restoredIdentity false arm requires no global git config on the machine */
        suffix = restoredIdentity
          ? ' — AUTO-UNSET (signed global identity now wins)'
          : ' — no global identity to fall back to; unset manually'
      }
      lines.push(`      - ${issue}${suffix}`)
    }
    lines.push('')
  }
  lines.push('  core.bare = true and a placeholder local identity (with a')
  lines.push('  global fallback) are reverted automatically. Remaining')
  lines.push('  findings need manual cleanup: edit `.git/config` or')
  lines.push('  `git config --unset <key>`.')
  lines.push('')
  lines.push('  Spec: docs/agents.md/fleet/git-config-write-guard.md')
  // Stdout is the channel Claude Code surfaces at SessionStart.
  process.stdout.write(lines.join('\n') + '\n')
}

// ---------------------------------------------------------------------------
// PreToolUse entry point — shared by Bash + Edit/Write
// ---------------------------------------------------------------------------

function checkPreToolUse(payload: ToolCallPayload): GuardResult {
  const toolName = payload.tool_name
  const input = payload.tool_input
  if (!input || typeof input !== 'object') {
    return undefined
  }
  if (toolName === 'Bash') {
    const command = (input as { command?: unknown | undefined }).command
    if (typeof command !== 'string') {
      return undefined
    }
    const hits = findBannedBashWrites(command)
    if (hits.length === 0) {
      return undefined
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return undefined
    }
    return block(buildBlockMessage('bash', hits))
  }
  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') {
    const filePath = (input as { file_path?: unknown | undefined }).file_path
    if (typeof filePath !== 'string' || !isLocalGitConfigPath(filePath)) {
      return undefined
    }
    let content: string | undefined
    if (toolName === 'Write') {
      const c = (input as { content?: unknown | undefined }).content
      if (typeof c === 'string') {
        content = c
      }
    } else {
      // Edit / MultiEdit — pass new_string through findBannedConfigWrites
      // even though it's a fragment. The INI parser tolerates partial input.
      const newString = (input as { new_string?: unknown | undefined })
        .new_string
      if (typeof newString === 'string') {
        content = newString
      }
    }
    if (!content) {
      return undefined
    }
    const hits = findBannedConfigWrites(content)
    if (hits.length === 0) {
      return undefined
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return undefined
    }
    return block(buildBlockMessage('edit', hits, filePath))
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Entry point — dispatches on the payload shape (SessionStart vs PreToolUse).
// SessionStart is a side-effect (auto-fix + stdout report) that returns no
// verdict; PreToolUse returns a block verdict or undefined.
// ---------------------------------------------------------------------------

export const check: GuardCheck = payload => {
  const hookEventName = (payload as { hook_event_name?: unknown | undefined })
    .hook_event_name
  // SessionStart mode — probe fleet repos for corruption (side-effect only;
  // auto-fixes + writes the report to stdout, never blocks).
  if (hookEventName === 'SessionStart') {
    const projectsDir = path.join(process.env['HOME'] ?? '', 'projects')
    const findings = scanFleetRepos(projectsDir)
    emitSessionStartReport(findings)
    return undefined
  }
  // PreToolUse mode — check the proposed tool call.
  return checkPreToolUse(payload)
}

export const hook = defineHook({
  bypass: ['git-config-write'],
  bypassMode: 'manual',
  check,
  event: 'SessionStart',
  type: 'guard',
})
void runHook(hook, import.meta.url)

export { BANNED_LOCAL_KEYS, BYPASS_PHRASE }
