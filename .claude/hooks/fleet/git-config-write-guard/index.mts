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
//    already-corrupted `.git/config` (bare = true, test-fixture email
//    leak, etc.) and reports them. `core.bare = true` is AUTO-RESTORED (it's
//    always wrong for a non-bare checkout and breaks every git command); the
//    identity/signing findings are reported for manual cleanup. Never blocks.
//
// Bypass: `Allow git-config-write bypass` (single-use, for genuine
// operator scenarios — initial signing setup on a fresh checkout, etc.).
//
// Exit codes:
//   0 — pass / SessionStart / fail-open.
//   2 — block (PreToolUse).
//
// Full rationale + key table: docs/claude.md/fleet/git-config-write-guard.md

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { FLEET_REPO_NAMES } from '../_shared/fleet-repos.mts'
import { withBashGuard, type ToolCallPayload } from '../_shared/payload.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow git-config-write bypass'

// Keys that must never live in a fleet repo's local `.git/config`.
// See docs/claude.md/fleet/git-config-write-guard.md for per-key
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
    const sectionMatch = /^\[([\w.-]+)(?:\s+"[^"]*")?\]$/.exec(line)
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.toLowerCase()
      continue
    }
    if (!currentSection) {
      continue
    }
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

function emitBlock(
  source: 'bash' | 'edit',
  hits: readonly BannedHit[],
  filePath?: string,
): void {
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
  lines.push('  Full spec: docs/claude.md/fleet/git-config-write-guard.md')
  logger.error(lines.join('\n') + '\n')
  process.exitCode = 2
}

// ---------------------------------------------------------------------------
// SessionStart: corruption probe
// ---------------------------------------------------------------------------

// Sentinel issue string for core.bare=true — the one corruption the probe
// auto-reverts (always wrong for a non-bare fleet checkout; safe to fix).
const BARE_ISSUE = 'core.bare = true (work tree treated as bare repo)'

const TEST_EMAIL_PATTERNS: readonly RegExp[] = [
  /test@example\.com/i,
  /test@.*\.example/i,
  /@example\.(com|org|net)/i,
]

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
  // Test-fixture email leaks
  for (let i = 0, { length } = TEST_EMAIL_PATTERNS; i < length; i += 1) {
    if (TEST_EMAIL_PATTERNS[i]!.test(raw)) {
      issues.push(
        'user.email looks like a test fixture (e.g. test@example.com)',
      )
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

function emitSessionStartReport(findings: readonly CorruptionFinding[]): void {
  if (findings.length === 0) {
    return
  }
  const lines: string[] = []
  lines.push(
    '[git-config-write-guard] Corruption detected in fleet repo local git configs:',
  )
  lines.push('')
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    lines.push(`  ${f.repo}`)
    lines.push(`    ${f.configPath}`)
    const restoredBare =
      f.issues.includes(BARE_ISSUE) && restoreBareToFalse(f.configPath)
    for (let j = 0, jl = f.issues.length; j < jl; j += 1) {
      const issue = f.issues[j]!
      const suffix =
        issue === BARE_ISSUE && restoredBare
          ? ' — AUTO-RESTORED to non-bare'
          : ''
      lines.push(`      - ${issue}${suffix}`)
    }
    lines.push('')
  }
  lines.push('  core.bare = true is reverted automatically (always wrong for a')
  lines.push('  non-bare fleet checkout). Remaining findings need manual')
  lines.push('  cleanup — edit `.git/config` or `git config --unset <key>`.')
  lines.push('')
  lines.push('  Spec: docs/claude.md/fleet/git-config-write-guard.md')
  // Stdout is the channel Claude Code surfaces at SessionStart.
  process.stdout.write(lines.join('\n') + '\n')
}

// ---------------------------------------------------------------------------
// PreToolUse entry point — shared by Bash + Edit/Write
// ---------------------------------------------------------------------------

function checkPreToolUse(payload: ToolCallPayload): void {
  const toolName = payload.tool_name
  const input = payload.tool_input
  if (!input || typeof input !== 'object') {
    return
  }
  if (toolName === 'Bash') {
    const command = (input as { command?: unknown }).command
    if (typeof command !== 'string') {
      return
    }
    const hits = findBannedBashWrites(command)
    if (hits.length === 0) {
      return
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return
    }
    emitBlock('bash', hits)
    return
  }
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') {
    const filePath = (input as { file_path?: unknown }).file_path
    if (typeof filePath !== 'string' || !isLocalGitConfigPath(filePath)) {
      return
    }
    let content: string | undefined
    if (toolName === 'Write') {
      const c = (input as { content?: unknown }).content
      if (typeof c === 'string') {
        content = c
      }
    } else {
      // Edit / MultiEdit — pass new_string through findBannedConfigWrites
      // even though it's a fragment. The INI parser tolerates partial input.
      const newString = (input as { new_string?: unknown }).new_string
      if (typeof newString === 'string') {
        content = newString
      }
    }
    if (!content) {
      return
    }
    const hits = findBannedConfigWrites(content)
    if (hits.length === 0) {
      return
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return
    }
    emitBlock('edit', hits, filePath)
  }
}

// ---------------------------------------------------------------------------
// CLI entry point — dispatches on stdin payload shape (PreToolUse vs
// SessionStart). Fails open on any throw.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return
  }
  if (!payload || typeof payload !== 'object') {
    return
  }
  const hookEventName = (payload as { hook_event_name?: unknown })
    .hook_event_name
  // SessionStart mode — probe fleet repos for corruption.
  if (hookEventName === 'SessionStart') {
    const projectsDir = path.join(process.env['HOME'] ?? '', 'projects')
    const findings = scanFleetRepos(projectsDir)
    emitSessionStartReport(findings)
    return
  }
  // PreToolUse mode — check the proposed tool call.
  checkPreToolUse(payload as ToolCallPayload)
}

if (process.argv[1]?.endsWith('index.mts')) {
  main().catch(() => {
    // Fail open per the fleet's hook contract.
    process.exitCode = 0
  })
}

export { BANNED_LOCAL_KEYS, BYPASS_PHRASE }
