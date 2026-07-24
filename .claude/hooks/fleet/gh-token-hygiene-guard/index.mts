#!/usr/bin/env node
// Claude Code PreToolUse hook — gh-token-hygiene-guard.
//
// Four invariants on `gh` invocations, motivated by the May 2026 Nx
// Console supply-chain compromise (malicious npm package exfiltrated
// ~/.config/gh/hosts.yml and used the token against the GitHub API in
// <74 seconds):
//
//   1. KEYRING STORAGE. `gh auth status` must report `(keyring)`. The
//      on-disk default at `~/.config/gh/hosts.yml` is exactly what the
//      Nx malware exfiltrated. No bypass — move the token off disk.
//      Fix: `gh auth logout && gh auth login` (keychain is the default
//      since gh 2.40; `--secure-storage` does not exist — the only flag
//      is `--insecure-storage` for opting out, which this hook rejects).
//      Detection is PER-HOST: extractHostBlock() isolates the
//      github.com block before checking, so a keyring-backed
//      github.enterprise.com login can't mask a file-backed github.com.
//
//   2. 8-HOUR IDLE TIMEOUT. The hook stamps ~/.claude/gh-token-issued-at on
//      `gh auth login` / `gh auth refresh` AND on every allowed `gh` command
//      (each use is activity), then blocks non-auth `gh` only once the token
//      has sat IDLE — no gh command — for >8h. Active use (pushing, API
//      calls) keeps resetting the clock, so a busy session never trips it;
//      only genuine inactivity counts toward the timeout. Self-recovery:
//      `gh auth refresh -h github.com` is always allowed (re-stamps).
//
//   3. WORKFLOW SCOPE ON-DEMAND, PHRASE-GATED. The `workflow` scope grants
//      dispatch power over every workflow including publish / release, so
//      elevating (`gh auth refresh -s workflow`) and dispatching
//      (`gh workflow run …`) each require the USER'S typed chat phrase:
//      `Allow workflow-scope bypass` for the elevation, and for a dispatch
//      either that phrase or the release-workflow-guard's per-workflow form
//      (`Allow workflow-dispatch bypass: <workflow>`) — one phrase opens
//      both gates. Revoking the scope needs no phrase. Per-workflow
//      single-use accounting lives in release-workflow-guard.
//
//   4. KEYCHAIN-CLI READ DETECTION. Routing through the existing
//      `no-blind-keychain-read-guard` handles `security
//      find-generic-password` etc. — not duplicated here.
//
// Exit codes:
//   - 0: pass (not a gh command, or all checks satisfied)
//   - 2: block (one of the invariants violated; stderr explains)
//
// Fail-open on hook bugs: runGuard swallows any throw and leaves exit 0
// so a bad deploy can't brick every gh command.
//
// Reads a PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash", "tool_input": { "command": "..." },
//     "transcript_path": "..." }

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardBlock, GuardResult } from '../_shared/guard.mts'
import { findInvocation, parseCommands } from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Pre-flight trigger for the dispatcher: skip importing this guard unless the
// raw command could invoke `gh`. The whole guard is gated on
// containsGhInvocation(), which short-circuits to false when the command does
// not contain the literal `gh` (findInvocation's substring pre-check), so a
// command without `gh` can never reach any block/notify path. Complete because
// every detection (storage / age / workflow dispatch / scope refresh / api
// dispatch) requires a parsed `gh` binary segment, which in turn requires `gh`
// verbatim in the command text.
export const triggers: readonly string[] = ['gh']

const BYPASS_PHRASE = 'Allow workflow-scope bypass'
const TOKEN_ISSUED_AT_FILE = path.join(
  os.homedir(),
  '.claude',
  'gh-token-issued-at',
)
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours IDLE (reset on each gh use)

interface GhAuthStatus {
  storage: 'keyring' | 'file' | 'unknown'
  scopes: readonly string[]
}

export const check = bashGuard((command, payload): GuardResult => {
  // Cheap pre-filter: only inspect commands that mention `gh`.
  if (!containsGhInvocation(command)) {
    return undefined
  }
  // The auth-status read is the slow path (~50ms). Skip it when the
  // gh command is a known read-only shape that doesn't touch tokens.
  // For now, run on every gh command — paranoid by default.
  let status: GhAuthStatus
  try {
    status = readGhAuthStatus()
  } catch {
    // gh not installed, or no active auth — let the command run and
    // gh itself will report. Don't double-block.
    return undefined
  }
  // Invariant 1: keyring storage.
  if (status.storage === 'file') {
    return fail(
      'gh-token-hygiene-guard: gh token is stored on disk',
      [
        'Your gh CLI token lives at ~/.config/gh/hosts.yml. Any local',
        'process can read it (this is exactly the path the Nx Console',
        'supply-chain malware exfiltrated in May 2026).',
        '',
        'Fix:',
        '  gh auth logout',
        '  gh auth login                          # keychain is the default',
        '  gh auth status                         # confirms "(keyring)"',
        '',
        'No bypass — moving the token off disk is non-negotiable.',
      ].join('\n'),
    )
  }
  // Invariant 4 (checked early so the user can self-recover by
  // running `gh auth refresh -h github.com` even when expired).
  // isTokenFresh() self-heals stale stamps via a `gh api user` probe,
  // so reaching here means the token genuinely failed the live probe
  // (or hit the network timeout).
  if (!isAuthMaintenanceCommand(command) && !isTokenFresh()) {
    return fail(
      'gh-token-hygiene-guard: gh token idle >8h (and live probe failed)',
      [
        'The fleet enforces an 8-hour IDLE timeout on the gh token — it',
        'trips only after no gh command for 8h (active use keeps resetting',
        'the clock). The hook probed `gh api user` to self-heal a stale',
        "stamp; the probe didn't return 200, so the token is genuinely",
        'expired or unreachable.',
        '',
        'Refresh:',
        '  gh auth refresh -h github.com',
      ].join('\n'),
    )
  }
  // Stamp the token-issued-at file on ANY auth-refresh / login flow.
  // The actual refresh runs after this hook; stamping pre-emptively is
  // fine because a failed refresh leaves the old token in place (and
  // the next successful refresh re-stamps). Parser-confirmed `gh auth
  // login|refresh` so a quoted mention doesn't spuriously re-stamp.
  if (
    parseCommands(command).some(
      c =>
        c.binary === 'gh' &&
        c.args.includes('auth') &&
        (c.args.includes('login') || c.args.includes('refresh')),
    )
  ) {
    recordTokenIssuedAt()
  }
  // Invariant 2: workflow scope on-demand, authorized by the user's typed
  // chat phrase. The phrase is the human factor — the release-workflow-guard
  // additionally enforces per-workflow single-use accounting on dispatches.
  const isWorkflowDispatch =
    isWorkflowDispatchCommand(command) || isWorkflowApiDispatch(command)
  const isWorkflowRefresh = isWorkflowScopeRefresh(command)
  const hasWorkflowScope = status.scopes.includes('workflow')
  if (isWorkflowRefresh) {
    // Revoke is always allowed (no bypass needed) — it's the de-elevation
    // this guard pushes you toward.
    if (isWorkflowScopeRevoke(command)) {
      return undefined
    }
    if (!bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return fail(
        'gh-token-hygiene-guard: adding workflow scope requires bypass',
        [
          `Type \`${BYPASS_PHRASE}\` in chat (a standalone message), then re-run:`,
          `  ${command}`,
        ].join('\n'),
      )
    }
    return undefined
  }
  if (isWorkflowDispatch) {
    if (!hasWorkflowScope) {
      return fail(
        'gh-token-hygiene-guard: workflow dispatch requires workflow scope',
        [
          'Token does not have the `workflow` scope. Elevate first:',
          `  1. Type \`${BYPASS_PHRASE}\` in chat (a standalone message).`,
          '  2. Run: gh auth refresh -h github.com -s workflow',
          '     (device flow — complete the browser step).',
          '  3. Re-run the dispatch.',
          '  4. When done, de-elevate: gh auth refresh -h github.com -r workflow',
        ].join('\n'),
      )
    }
    // The user's typed phrase authorizes the dispatch — either this guard's
    // own phrase or the release guard's per-workflow phrase
    // (`Allow workflow-dispatch bypass: <workflow>`), so ONE phrase opens
    // both gates.
    if (
      !bypassPhrasePresent(
        payload.transcript_path,
        dispatchBypassPhrases(command),
      )
    ) {
      return fail(
        'gh-token-hygiene-guard: workflow dispatch requires bypass',
        [
          'Type ONE of these in chat (a standalone message), then re-run:',
          ...dispatchBypassPhrases(command).map(p => `  ${p}`),
        ].join('\n'),
      )
    }
  }
  return undefined
})

// True when any command segment actually invokes the `gh` binary. Uses
// the shell parser, not regex: a regex on `gh` over-matched (a path or a
// quoted string containing "gh" tripped it — see the false positives this
// hook used to throw on `grep gh`) AND under-matched (missed indirection).
// The parser reads the real binary at each segment, so `echo "gh ..."`
// (quoted, not a command) is correctly ignored and `cmd1 && gh ...`
// (chained) is caught.
function containsGhInvocation(command: string): boolean {
  return findInvocation(command, { binary: 'gh' })
}

// Flags on `gh workflow run` that take a value, so the value is never
// mistaken for the workflow target (mirrors release-workflow-guard).
const GH_WORKFLOW_VALUE_FLAGS = new Set([
  '--field',
  '--json',
  '--raw-field',
  '--ref',
  '--repo',
  '-F',
  '-f',
  '-R',
  '-r',
])

// The phrases that authorize a workflow dispatch from chat: this guard's
// own phrase plus the release guard's per-workflow forms for the command's
// actual target (with and without the .yml extension), so the user types
// ONE phrase to open both gates.
export function dispatchBypassPhrases(command: string): string[] {
  const phrases = [BYPASS_PHRASE]
  const target = workflowDispatchTarget(command)
  if (target) {
    phrases.push(
      `Allow workflow-dispatch bypass: ${target}`,
      `Allow workflow-dispatch bypass: ${target.replace(/\.ya?ml$/i, '')}`,
    )
  }
  return phrases
}

// The workflow target of a `gh workflow run <target> …` segment: the first
// positional arg after `run`, skipping flags and their values.
export function workflowDispatchTarget(command: string): string | undefined {
  const segments = parseCommands(command)
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!
    if (segment.binary !== 'gh') {
      continue
    }
    const { args } = segment
    const runIdx = args.indexOf('workflow') >= 0 ? args.indexOf('run') : -1
    if (runIdx < 0) {
      continue
    }
    for (let j = runIdx + 1, argsLength = args.length; j < argsLength; j += 1) {
      const arg = args[j]!
      if (GH_WORKFLOW_VALUE_FLAGS.has(arg)) {
        j += 1
        continue
      }
      if (arg.startsWith('-')) {
        continue
      }
      return arg
    }
  }
  return undefined
}

// A `gh` segment whose args contain `workflow` then `run`/`dispatch`.
// Parser-confirmed `gh` binary + structured arg check (the args list,
// not a raw-string regex, so a quoted "workflow run" can't trip it).
export function isWorkflowDispatchCommand(command: string): boolean {
  return parseCommands(command).some(
    c =>
      c.binary === 'gh' &&
      c.args.includes('workflow') &&
      (c.args.includes('run') || c.args.includes('dispatch')),
  )
}

// `gh api …/actions/workflows/<id>/dispatches`. Parser-confirms the `gh`
// binary, then checks the args for the dispatches API path.
export function isWorkflowApiDispatch(command: string): boolean {
  return parseCommands(command).some(
    c =>
      c.binary === 'gh' &&
      c.args.includes('api') &&
      c.args.some(a => /\/actions\/workflows\/[^/\s]+\/dispatches\b/.test(a)),
  )
}

// `gh auth refresh` with a scope flag (`-s`/`--scopes` add, `-r`/
// `--remove-scopes` remove) referencing `workflow`. Parser-confirms the
// `gh auth refresh` shape; the scope value can be `workflow` or a
// comma-list containing it (`-s repo,workflow`), so test each arg.
function isWorkflowScopeRefresh(command: string): boolean {
  return parseCommands(command).some(c => {
    if (
      c.binary !== 'gh' ||
      !c.args.includes('auth') ||
      !c.args.includes('refresh')
    ) {
      return false
    }
    // Find a scope flag, then look at the value token(s) for `workflow`.
    for (let i = 0; i < c.args.length; i += 1) {
      const a = c.args[i]!
      const isScopeFlag = /^(?:--remove-scopes|--scopes|-r|-s)$/.test(a)
      // Inline form: `--scopes=workflow` or `-sworkflow`.
      if (/^(?:--remove-scopes|--scopes|-r|-s)\b.*workflow\b/.test(a)) {
        return true
      }
      if (isScopeFlag) {
        const value = c.args[i + 1]
        if (value && /\bworkflow\b/.test(value)) {
          return true
        }
      }
    }
    return false
  })
}

// A `gh auth refresh` whose `-r`/`--remove-scopes` value names `workflow`.
// Parser-confirmed like its isWorkflowScopeRefresh sibling — a quoted
// "gh auth refresh -r workflow" in a heredoc or message body is not a
// revoke.
function isWorkflowScopeRevoke(command: string): boolean {
  return parseCommands(command).some(c => {
    if (
      c.binary !== 'gh' ||
      !c.args.includes('auth') ||
      !c.args.includes('refresh')
    ) {
      return false
    }
    for (let i = 0, { length } = c.args; i < length; i += 1) {
      const a = c.args[i]!
      // Inline form: `--remove-scopes=workflow` or `-rworkflow`.
      if (/^(?:--remove-scopes|-r)\b.*workflow\b/.test(a)) {
        return true
      }
      if (a === '--remove-scopes' || a === '-r') {
        const value = c.args[i + 1]
        if (value && /\bworkflow\b/.test(value)) {
          return true
        }
      }
    }
    return false
  })
}

// Self-recovery commands that must run even when the age-block is active —
// otherwise the user is locked out. Parser-confirmed `gh auth <verb>` so a
// quoted mention can't exempt an unrelated stale-token command.
function isAuthMaintenanceCommand(command: string): boolean {
  return parseCommands(command).some(c => {
    if (c.binary !== 'gh') {
      return false
    }
    const verbs = c.args.filter(a => !a.startsWith('-'))
    return (
      verbs[0] === 'auth' &&
      (verbs[1] === 'login' ||
        verbs[1] === 'logout' ||
        verbs[1] === 'refresh' ||
        verbs[1] === 'status')
    )
  })
}

// 2020-01-01T00:00:00Z in epoch ms. Any stamp file value below this is
// either zero, a POSIX-seconds value (~1.7e9) mistakenly written instead
// of ms (~1.7e12), or garbage. Treat as malformed and re-stamp so a
// user who attempted `date "+%s" > ~/.claude/gh-token-issued-at`
// doesn't get permanently blocked.
const MIN_PLAUSIBLE_STAMP_MS = 1_577_836_800_000

function isTokenFresh(): boolean {
  if (!existsSync(TOKEN_ISSUED_AT_FILE)) {
    // First run: stamp now and treat as fresh. This makes the hook
    // ship-able without forcing every developer to re-auth on first
    // upgrade — the 8h clock starts from the moment the hook first
    // observes them.
    recordTokenIssuedAt()
    return true
  }
  try {
    const recorded = Number(readFileSync(TOKEN_ISSUED_AT_FILE, 'utf8'))
    if (!Number.isFinite(recorded)) {
      return false
    }
    // Malformed value (zero, POSIX-seconds, garbage) — re-stamp and
    // treat as fresh. The actual gh token in keychain is what matters
    // for security; this stamp file just tracks when we last saw a
    // confirmed refresh. A wrong value here would lock the user out
    // until they figured out the file format.
    if (recorded < MIN_PLAUSIBLE_STAMP_MS) {
      recordTokenIssuedAt()
      return true
    }
    if (Date.now() - recorded < TOKEN_TTL_MS) {
      // Idle-based: this gh command IS activity, so reset the idle clock to
      // now. Only genuine inactivity (no gh command for TOKEN_TTL_MS)
      // advances toward the block — active pushing / API use never counts
      // against the timeout.
      recordTokenIssuedAt()
      return true
    }
    // Stamp says idle past the timeout. Self-heal: the user may have used gh
    // in a side shell (so the PreToolUse-driven re-stamp never fired). Probe
    // the token directly via a cheap unauthenticated-rate-limit API call.
    // If gh accepts it (exit 0), the token IS fresh; re-stamp and
    // proceed. If gh rejects it (exit non-zero / 401), the stamp was
    // right and the token really is dead.
    if (probeTokenValid()) {
      recordTokenIssuedAt()
      return true
    }
    return false
  } catch {
    return false
  }
}

// Lightweight liveness check. `gh api user` is the standard "am I
// authenticated" probe — 1 request, returns the user object on 200,
// fails non-zero on 401/network issues. Timeout-bounded so a network
// blackout doesn't hang the hook.
function probeTokenValid(): boolean {
  const result = spawnSync('gh', ['api', 'user', '--jq', '.login'], {
    shell: WIN32,
    stdio: 'pipe',
    // win-timeout: network — bounded `gh api` call; keep it fixed, don't scale by platform.
    timeout: 5000,
  })
  return result.status === 0
}

function recordTokenIssuedAt(): void {
  try {
    mkdirSync(path.dirname(TOKEN_ISSUED_AT_FILE), { recursive: true })
    writeFileSync(TOKEN_ISSUED_AT_FILE, String(Date.now()), 'utf8')
  } catch {
    // best-effort
  }
}

function readGhAuthStatus(): GhAuthStatus {
  // `gh auth status` is a LOCAL keyring read (no network); spawnTimeoutMs keeps
  // it tight on POSIX but gives win32 headroom for cmd.exe spawn latency. Too
  // tight and a slow-but-alive gh is killed → empty output → this reads it as
  // "gh absent" and fail-opens, silently skipping the storage check.
  const r = spawnSync('gh', ['auth', 'status'], {
    shell: WIN32,
    stdio: 'pipe',
    stdioString: true,
    timeout: spawnTimeoutMs(5000),
  })
  const text = String(r.stdout ?? '') + String(r.stderr ?? '')
  if (!text) {
    throw new Error('gh auth status: no output')
  }
  // Per-host parse. `gh auth status` lists every host the user is logged
  // in to, each as its own block. We care about github.com specifically.
  // Substring-matching the entire blob for `(keyring)` was a vuln: if the
  // user is logged in to both github.com (file-backed) AND
  // github.enterprise.com (keyring-backed), the regex sees `(keyring)`
  // anywhere and concludes the github.com token is safe.
  const githubComBlock = extractHostBlock(text, 'github.com')
  let storage: GhAuthStatus['storage'] = 'unknown'
  if (githubComBlock) {
    // Keyring/keychain storage signal in the `gh auth status` github.com block.
    if (/\(keyring\)|stored in:\s*keychain/i.test(githubComBlock)) {
      storage = 'keyring'
    } else if (/Logged in to github\.com/i.test(githubComBlock)) {
      storage = 'file'
    }
  }
  // Scopes are still parsed from the github.com block.
  const scopesText = githubComBlock ?? text
  const scopesMatch = scopesText.match(/Token scopes:\s*(?<list>.+)/i)
  const scopes = scopesMatch
    ? scopesMatch.groups!.list!.split(',').map(s =>
        // Trim, then strip one leading or trailing quote char (a single- or
        // double-quoted scope token in the `gh auth status` output).
        s.trim().replace(/^['"]|['"]$/g, ''),
      )
    : []
  return { storage, scopes }
}

// Extract a single host's block from `gh auth status` output.
// Block boundaries: from the line containing the host header
// (typically `github.com` or `github.enterprise.com` as the FIRST
// non-blank chars on its own line, optionally followed by `:`) to
// the next host header OR EOF.
function extractHostBlock(text: string, host: string): string | undefined {
  const lines = text.split('\n')
  // Match the host header — a line starting with the host name (with
  // optional `:` suffix) at zero or low indent.
  const headerRe = /^\S+/
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (!headerRe.test(line)) {
      continue
    }
    const trimmed = line.trim().replace(/:$/, '')
    if (start === -1) {
      if (trimmed === host) {
        start = i
      }
    } else {
      // Already inside our block — next header line ends it.
      end = i
      break
    }
  }
  if (start === -1) {
    return undefined
  }
  return lines.slice(start, end).join('\n')
}

function fail(headline: string, body: string): GuardBlock {
  return block(`\n${headline}\n\n${body}\n\n`)
}

export const hook = defineHook({
  bypass: ['workflow-scope', 'workflow-dispatch'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
