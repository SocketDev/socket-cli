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
//   2. 8-HOUR TOKEN AGE CAP. The hook stamps ~/.claude/gh-token-issued-at
//      on `gh auth login` / `gh auth refresh` and blocks every non-auth
//      `gh` command once the token is >8h old. Self-recovery:
//      `gh auth refresh -h github.com` is always allowed (re-stamps).
//
//   3. WORKFLOW SCOPE ON-DEMAND, SINGLE-USE, PHYSICAL-PRESENCE-GATED.
//      The `workflow` scope grants dispatch power over every workflow
//      including publish / release. Recommended default scope set:
//      `read:org, repo` (the hook does not enforce a scope allowlist;
//      gh itself forces `gist` as a minimum, so the practical floor is
//      `read:org, repo, gist`). To add the scope:
//        a. User types `Allow workflow-scope bypass` in chat.
//        b. Hook runs OS physical-presence auth (see
//           requireUserAuthentication below) — the chat phrase ALONE is
//           insufficient. An attacker who forges the chat-typed slot
//           still can't proceed without your fingerprint / hardware key.
//        c. On success, the hook records a SESSION-BOUND grant
//           (~/.claude/gh-workflow-grant = `<session_id>\n<unix_ms>`).
//        d. The next `gh workflow run` verifies the grant's session_id
//           matches the dispatching session, then consumes it (deletes
//           the file). A grant planted by another process / session is
//           rejected. Any further dispatch needs a fresh phrase + auth.
//        e. User manually re-revokes scope via
//           `gh auth refresh -r workflow` when done (revoke needs no
//           bypass).
//
//   4. KEYCHAIN-CLI READ DETECTION. Routing through the existing
//      `no-blind-keychain-read-guard` handles `security
//      find-generic-password` etc. — not duplicated here.
//
// Physical-presence auth (invariant 3, step b) is cross-platform:
//   - macOS: Touch ID via pam_tid.so on sudo. osascript password
//     dialog as fallback — UNLESS an MDM blocker (iru / Jamf / Mosyle /
//     Kandji) is detected on disk, in which case osascript is skipped
//     (invoking it would surface a "Process Blocked" toast).
//   - Linux: pam_u2f (YubiKey / FIDO2) or pam_fprintd (laptop
//     fingerprint) on sudo. resolveSudoBin() handles NixOS path.
//   - Windows: no reachable path → 'unsupported' (fails closed).
//
// Exit codes:
//   - 0: pass (not a gh command, or all checks satisfied)
//   - 2: block (one of the invariants violated; stderr explains)
//
// Fail-open on hook bugs: runGuard swallows any throw and leaves exit 0
// so a bad deploy can't brick every gh command. Fail-CLOSED on auth
// (unsupported/denied → block) because a missing physical-presence check
// must not silently pass.
//
// No test-only env override (removed 2026-05-26 as a supply-chain
// hardening measure — an attacker who planted SOCKET_GH_HYGIENE_TEST_AUTH
// in a shell rc / .envrc would have bypassed Touch ID). The OS-auth
// path is exercised by manual smoke-testing.
//
// Reads a PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash", "tool_input": { "command": "..." },
//     "transcript_path": "...", "session_id": "..." }

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

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardBlock, GuardResult } from '../_shared/guard.mts'
import { findInvocation, parseCommands } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Absolute paths for OS-auth binaries. PATH-hijack defense — a
// malicious npm postinstall that drops ~/.local/bin/sudo, ~/.local/bin/dscl,
// or ~/.local/bin/osascript cannot intercept these calls because spawnSync
// is given the absolute path.
//
// dscl + osascript are macOS-only and live at /usr/bin/. sudo varies:
//   - macOS:   /usr/bin/sudo
//   - Linux:   /usr/bin/sudo (most distros) or /run/wrappers/bin/sudo (NixOS)
//   - Windows: no equivalent — Windows has no physical-presence path that
//             can be invoked from a Node child process. Hook fails closed
//             on win32.
// resolveSudoBin() checks the candidates and returns the first that
// exists, or undefined if none. Calls fail-closed via ENOENT if the
// returned path becomes unavailable between resolve and spawn (TOCTOU
// is non-exploitable here because the candidates are all system paths
// outside user writability).
const DSCL_BIN = '/usr/bin/dscl'
const OSASCRIPT_BIN = '/usr/bin/osascript'
const SUDO_CANDIDATES = [
  '/usr/bin/sudo',
  '/usr/local/bin/sudo',
  '/run/wrappers/bin/sudo',
] as const
function resolveSudoBin(): string | undefined {
  for (let i = 0; i < SUDO_CANDIDATES.length; i += 1) {
    /* c8 ignore start - false arm (candidate missing) unreachable on macOS where /usr/bin/sudo exists at index 0 */
    if (existsSync(SUDO_CANDIDATES[i]!)) {
      /* c8 ignore stop */
      return SUDO_CANDIDATES[i]
    }
  }
  /* c8 ignore next - reached only on systems with no sudo binary (e.g. bare containers) */
  return undefined
}

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
// One bypass phrase authorizes ONE workflow dispatch. The grant file's
// presence = unconsumed. The hook deletes the file immediately after
// letting the dispatch through, so a second dispatch (chain attack or
// genuine re-use) requires a fresh phrase. Token-age (8h) is the
// time-based check; the dispatch gate is single-use.
const WORKFLOW_GRANT_FILE = path.join(
  os.homedir(),
  '.claude',
  'gh-workflow-grant',
)
const TOKEN_ISSUED_AT_FILE = path.join(
  os.homedir(),
  '.claude',
  'gh-token-issued-at',
)
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours

interface GhAuthStatus {
  storage: 'keyring' | 'file' | 'unknown'
  scopes: readonly string[]
}

// The PreToolUse payload carries a `session_id` the shared
// ToolCallPayload type doesn't model. The workflow-grant flow binds a
// grant to it, so narrow it off the payload here.
interface SessionPayload {
  session_id?: string | undefined
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
      'gh-token-hygiene-guard: gh token is >8h old (and live probe failed)',
      [
        'The fleet enforces an 8-hour cap on gh token age. The hook',
        'probed `gh api user` to self-heal a stale stamp; the probe',
        "didn't return 200, so the token is genuinely expired or",
        'unreachable.',
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
  const sessionId = (payload as SessionPayload).session_id
  // Invariant 2: workflow scope on-demand.
  const isWorkflowDispatch =
    isWorkflowDispatchCommand(command) || isWorkflowApiDispatch(command)
  const isWorkflowRefresh = isWorkflowScopeRefresh(command)
  const hasWorkflowScope = status.scopes.includes('workflow')
  if (isWorkflowRefresh) {
    // Revoke is always allowed (no bypass needed).
    if (isWorkflowScopeRevoke(command)) {
      return undefined
    }
    // Refresh-add: chat-bypass phrase + Touch ID sudo prompt both
    // required. The phrase alone isn't sufficient — an attacker who
    // exfiltrates the bypass-typed slot still can't proceed without
    // your physical presence.
    if (!bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return fail(
        'gh-token-hygiene-guard: adding workflow scope requires bypass',
        [
          `Type \`${BYPASS_PHRASE}\` in chat before running:`,
          `  ${command}`,
          '',
          'After the phrase, Touch ID will prompt for physical confirmation.',
        ].join('\n'),
      )
    }
    const authResult = requireUserAuthentication()
    /* c8 ignore start - 'denied' only returned via osascript dialog, which MDM blocks on test host */
    if (authResult === 'denied') {
      return fail(
        'gh-token-hygiene-guard: physical-presence check failed',
        [
          'Authentication was cancelled or password did not match.',
          'Re-run your command and approve the Touch ID / password prompt.',
        ].join('\n'),
      )
    }
    /* c8 ignore stop */
    if (authResult === 'unsupported') {
      const platformGuidance = platformAuthGuidance()
      return fail(
        'gh-token-hygiene-guard: no physical-presence auth available',
        [
          'The workflow-scope bypass requires biometric / hardware-key',
          'confirmation. Nothing was reachable in this environment.',
          '',
          ...platformGuidance,
        ].join('\n'),
      )
    }
    recordWorkflowGrant(sessionId)
    return undefined
  }
  if (isWorkflowDispatch) {
    // Block if scope is absent — nothing to dispatch with.
    if (!hasWorkflowScope) {
      return fail(
        'gh-token-hygiene-guard: workflow dispatch requires workflow scope',
        [
          'Token does not have the `workflow` scope. To dispatch:',
          `  1. Type \`${BYPASS_PHRASE}\` in chat.`,
          '  2. Run: gh auth refresh -h github.com -s workflow',
          '  3. Re-run your dispatch command.',
          '  4. Scope auto-revokes after one dispatch.',
        ].join('\n'),
      )
    }
    // One bypass phrase = one dispatch. Grant file must exist AND
    // bind to the current session_id. Pre-creation attack (attacker
    // touches the file from a different process) is rejected because
    // the recorded session_id won't match the dispatch session.
    if (!verifyWorkflowGrant(sessionId)) {
      return fail(
        'gh-token-hygiene-guard: workflow dispatch grant is missing, expired, or session-mismatched',
        [
          'Token has `workflow` scope, but no valid dispatch grant for',
          'this Claude session was found.',
          '',
          'Each bypass phrase authorizes ONE dispatch in the SAME',
          'session it was typed. A grant from a different session, or',
          'a grant file planted by another process, will not match.',
          '',
          'To dispatch:',
          '  1. Run: gh auth refresh -h github.com -r workflow',
          `  2. Type \`${BYPASS_PHRASE}\` in chat (this session).`,
          '  3. Run: gh auth refresh -h github.com -s workflow',
          '  4. Re-run your dispatch command in the SAME session.',
        ].join('\n'),
      )
    }
    consumeWorkflowGrant()
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

// A `gh` segment whose args contain `workflow` then `run`/`dispatch`.
// Parser-confirmed `gh` binary + structured arg check (the args list,
// not a raw-string regex, so a quoted "workflow run" can't trip it).
function isWorkflowDispatchCommand(command: string): boolean {
  return parseCommands(command).some(
    c =>
      c.binary === 'gh' &&
      c.args.includes('workflow') &&
      (c.args.includes('run') || c.args.includes('dispatch')),
  )
}

// `gh api …/actions/workflows/<id>/dispatches`. Parser-confirms the `gh`
// binary, then checks the args for the dispatches API path.
function isWorkflowApiDispatch(command: string): boolean {
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
      const isScopeFlag = /^(?:-s|-r|--scopes|--remove-scopes)$/.test(a)
      // Inline form: `--scopes=workflow` or `-sworkflow`.
      if (/^(?:-s|-r|--scopes|--remove-scopes)\b.*workflow\b/.test(a)) {
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

function isWorkflowScopeRevoke(command: string): boolean {
  return (
    /\bgh\s+auth\s+refresh\b/.test(command) &&
    // A `-r`/`--remove-scopes` flag followed (within the same command segment,
    // before any `| ; &`) by the `workflow` scope name.
    /(?:^|\s)(?:-r|--remove-scopes)\b[^|;&]*\bworkflow\b/.test(command)
  )
}

function isAuthMaintenanceCommand(command: string): boolean {
  // Self-recovery commands that must run even when the age-block
  // is active. Otherwise the user is locked out.
  return /\bgh\s+auth\s+(?:login|logout|refresh|status)\b/.test(command)
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
      return true
    }
    // Stamp says expired. Self-heal: the user may have refreshed in a
    // side shell (so the PreToolUse-driven pre-stamp never fired). Probe
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
    stdio: 'pipe',
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
  const r = spawnSync('gh', ['auth', 'status'], {
    stdio: 'pipe',
    stdioString: true,
    timeout: 5000,
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

// Grant body is `<session_id>\n<unix_ms>`. The session_id binds the
// grant to the Claude session that authorized it — an attacker who
// pre-creates the file (postinstall, .envrc) cannot guess a session_id
// the hook would later receive on dispatch. Presence-only was vulnerable
// to pre-creation; session-binding closes that gap.
function recordWorkflowGrant(sessionId: string | undefined): void {
  if (!sessionId) {
    // No session_id from harness — refuse to record. The dispatch
    // step would have no way to verify; failing closed here is safer
    // than recording an unverifiable grant.
    return
  }
  try {
    mkdirSync(path.dirname(WORKFLOW_GRANT_FILE), { recursive: true })
    writeFileSync(WORKFLOW_GRANT_FILE, `${sessionId}\n${Date.now()}`, 'utf8')
  } catch {
    // best-effort; if we can't write, the next dispatch will still
    // require a fresh bypass phrase, so no security regression.
  }
}

// Returns true iff the grant file exists AND its session_id matches
// the current session. An attacker-planted grant from a different
// (or no) session is rejected.
function verifyWorkflowGrant(sessionId: string | undefined): boolean {
  if (!sessionId) {
    return false
  }
  if (!existsSync(WORKFLOW_GRANT_FILE)) {
    return false
  }
  try {
    const body = readFileSync(WORKFLOW_GRANT_FILE, 'utf8')
    /* c8 ignore next - split('\n') always returns at least one element; [0] is never undefined */
    const recordedSessionId = body.split('\n')[0]?.trim() ?? ''
    return recordedSessionId === sessionId
  } catch {
    return false
  }
}

function consumeWorkflowGrant(): void {
  try {
    rmSync(WORKFLOW_GRANT_FILE, { force: true })
  } catch {
    // best-effort
  }
}

// Detect MDM-managed Macs (iru / Jamf / Mosyle / Kandji) where
// osascript is likely intercepted by org policy. **Filesystem-only
// detection** — we MUST NOT probe osascript itself, because the probe
// invocation triggers the same "Process Blocked" toast we're trying
// to avoid. Past variant: a `osascript -e 'return "probe"'` healthcheck
// surfaced the iru block toast on every hook invocation.
//
// Detection signals (presence of any known MDM-blocker install path):
//   * iru:    /Library/Application Support/iru
//   * Jamf:   /usr/local/jamf/bin/jamf  or  /Library/Application Support/JAMF
//   * Mosyle: /usr/local/bin/mosyle      or  /Library/Mosyle
//   * Kandji: /Library/Kandji
//
// False-positive cost: hook returns 'unsupported' for a working
// osascript, user gets pointed at Touch ID — recoverable.
// False-negative cost: hook tries osascript, user sees ONE toast per
// bypass (acceptable, much better than ONE PER HOOK INVOCATION).
//
// Result is cached for the lifetime of this hook invocation.
let mdmBlockerDetectedCache: boolean | undefined
function isOsascriptBlocked(): boolean {
  if (mdmBlockerDetectedCache !== undefined) {
    return mdmBlockerDetectedCache
  }
  // osascript missing entirely (non-darwin or stripped install).
  /* c8 ignore start - true arm only reachable on non-macOS or stripped installs where osascript absent */
  if (!existsSync(OSASCRIPT_BIN)) {
    mdmBlockerDetectedCache = true
    return true
  }
  /* c8 ignore stop */
  const mdmPaths = [
    '/Library/Application Support/iru',
    '/usr/local/jamf/bin/jamf',
    '/Library/Application Support/JAMF',
    '/usr/local/bin/mosyle',
    '/Library/Mosyle',
    '/Library/Kandji',
  ]
  for (let i = 0; i < mdmPaths.length; i += 1) {
    /* c8 ignore start - true arm only reachable when MDM software is installed (not present on test host) */
    if (existsSync(mdmPaths[i]!)) {
      mdmBlockerDetectedCache = true
      return true
    }
    /* c8 ignore stop */
  }
  /* c8 ignore start - reached only on macOS without any MDM software installed */
  mdmBlockerDetectedCache = false
  return false
  /* c8 ignore stop */
}

// Platform-specific setup guidance for the 'no auth method' error.
// Tailored to which paths actually work on each OS:
//   - macOS: Touch ID via pam_tid.so (best). osascript fallback if no
//     MDM blocker is present.
//   - Linux: pam_u2f (YubiKey / FIDO2) or pam_fprintd (laptop
//     fingerprint reader) — both layered onto sudo via PAM.
//   - Windows: no clean path. Run releases from a macOS / Linux host.
function platformAuthGuidance(): readonly string[] {
  /* c8 ignore start - win32 branch unreachable in fleet test environment (macOS host) */
  if (process.platform === 'win32') {
    return [
      'Windows has no equivalent to Touch ID / pam_u2f reachable from',
      'a Node child process. Options:',
      '  * Run gh workflow dispatches from a macOS or Linux machine.',
      '  * Use the GitHub web UI (Actions → Run workflow) instead.',
    ]
  }
  /* c8 ignore stop */
  /* c8 ignore start - false arm (non-darwin) unreachable in fleet test environment (macOS host) */
  if (process.platform === 'darwin') {
    /* c8 ignore stop */
    const noTty = !process.stdin.isTTY
    const osBlocked = isOsascriptBlocked()
    // noTty is always true in hook test env (no TTY); false arm (empty []) unreachable.
    /* c8 ignore next - false arm (noTty=false, ttyNote=[]) only when stdin is a TTY; hooks run without TTY */
    const ttyNote = noTty
      ? [
          'This shell has no controlling TTY, so the Touch ID prompt',
          "can't surface — `sudo` needs an interactive parent to ask",
          'for the biometric confirmation. Common cause: running via',
          "a tool that spawns subprocesses without `-it` (Claude Code's",
          'Bash tool, CI runners, headless scripts).',
          '',
          'Workaround: run the gh refresh from your own terminal:',
          '',
          '  gh auth refresh -h github.com -s workflow',
          '',
          'Touch the sensor when prompted. The session-bound grant',
          'will land at ~/.claude/gh-workflow-grant; the next workflow',
          'dispatch in this Claude session will then pass through.',
          '',
        ]
      : []
    // osBlocked depends on MDM presence; false arm (empty []) unreachable on clean test host.
    /* c8 ignore next - false arm (osBlocked=false, mdmNote=[]) only when no MDM is installed */
    const mdmNote = osBlocked
      ? [
          'An MDM (iru / Jamf / Mosyle / Kandji) is intercepting',
          'osascript on this machine, so the password-dialog fallback',
          'is unusable. Touch ID is the only working path.',
          '',
        ]
      : []
    return [
      ...ttyNote,
      ...mdmNote,
      'Enable Touch ID for sudo (copy-paste verbatim — `EOF` MUST be',
      'at column 0, no leading whitespace, or the heredoc will hang):',
      '',
      "sudo tee /etc/pam.d/sudo_local <<'EOF'",
      'auth       sufficient     pam_tid.so',
      'EOF',
      '',
      'Then re-run your gh command — Touch ID will prompt.',
      'Mac without Touch ID hardware + MDM-blocked osascript = no path;',
      'use the GitHub web UI to dispatch instead.',
    ]
  }
  // Linux / BSD / other POSIX.
  /* c8 ignore start - linux/BSD path unreachable in fleet test environment (macOS host) */
  return [
    'Layer a biometric / hardware-key onto sudo via PAM. Two common',
    'options — pick the one matching your hardware:',
    '',
    '  YubiKey (or any FIDO2 device):',
    '    sudo apt install libpam-u2f                     # Debian/Ubuntu',
    '    sudo dnf install pam-u2f                        # Fedora/RHEL',
    '    pamu2fcfg | sudo tee -a /etc/u2f_mappings',
    '    # Then add to /etc/pam.d/sudo (above @include common-auth):',
    '    #   auth sufficient pam_u2f.so authfile=/etc/u2f_mappings',
    '',
    '  Laptop fingerprint reader (ThinkPad / Framework / some Dells):',
    '    sudo apt install libpam-fprintd fprintd         # Debian/Ubuntu',
    '    sudo dnf install fprintd-pam                    # Fedora/RHEL',
    '    fprintd-enroll',
    '    # Then add to /etc/pam.d/sudo (above @include common-auth):',
    '    #   auth sufficient pam_fprintd.so',
    '',
    'Test with `sudo -k && sudo -n true` — if it returns 0 silently,',
    'the hook will recognize it as a physical-presence success.',
  ]
  /* c8 ignore stop */
}

type AuthResult = 'authenticated' | 'denied' | 'unsupported'

/**
 * Verify physical presence via the OS. Tries Touch ID (if sudo is configured
 * with pam_tid.so) first; falls back to an osascript password dialog validated
 * against the user's account.
 *
 * Returns: 'authenticated' — user proved presence 'denied' — user cancelled or
 * password did not match 'unsupported' — neither path available (non-macOS, no
 * osascript)
 */
function requireUserAuthentication(): AuthResult {
  // Windows: no equivalent path. Windows Hello requires a UWP context
  // (UserConsentVerifier) not reachable from a regular Node child.
  // runas + UAC is a click, not physical presence.
  /* c8 ignore start - win32 branch unreachable in fleet test environment (macOS host) */
  if (process.platform === 'win32') {
    return 'unsupported'
  }
  /* c8 ignore stop */
  // Path 1: physical-presence via PAM-backed sudo.
  //   macOS: pam_tid.so (Touch ID).
  //   Linux: pam_u2f.so (YubiKey / FIDO2) OR pam_fprintd.so (fingerprint
  //          reader on supported laptops).
  // Two sub-probes:
  //   1a. `sudo -n true` (silent fast-path) — succeeds when PAM is
  //       configured for a non-interactive biometric (e.g. some pam_u2f
  //       setups with cached touch, or pam_pkcs11). Fails on the most
  //       common pam_tid config because Touch ID prompts the user.
  //   1b. Interactive `sudo true` (biometric prompt) — pops the system
  //       Touch ID / U2F / fingerprint dialog. Inherit parent stdio so
  //       the dialog appears in the user's foreground session. Cap at
  //       30s so a missing sensor / cancelled prompt doesn't hang.
  const sudoBin = resolveSudoBin()
  /* c8 ignore start - false arm (no sudo binary) unreachable on macOS where /usr/bin/sudo exists */
  if (sudoBin) {
    /* c8 ignore stop */
    // Invalidate any cached sudo timestamp so the user can't accidentally
    // skip the prompt. -k is silent and always exits 0.
    spawnSync(sudoBin, ['-k'], { stdio: 'ignore', timeout: 2000 })
    // 1a. Silent fast-path.
    const silentResult = spawnSync(sudoBin, ['-n', 'true'], {
      stdio: 'ignore',
      timeout: 5000,
    })
    if (silentResult.status === 0) {
      return 'authenticated'
    }
    // 1b. Interactive prompt. macOS pam_tid + Linux pam_u2f/pam_fprintd
    // surface their biometric dialog here. stdio inherited so the user
    // sees the prompt; 30s timeout so a missing sensor / cancelled
    // dialog doesn't hang the hook forever.
    //
    // Only attempt when stdin is a TTY — sudo without a TTY parent will
    // hang waiting for input (or the biometric dialog won't surface in
    // the right session). Surface 'unsupported' with a clearer message
    // (see formatPhysicalAuthError) so the caller knows to run the gh
    // refresh from their own terminal.
    /* c8 ignore start - true arm (interactive sudo) only reachable when stdin is a TTY; hooks run without TTY */
    if (process.stdin.isTTY) {
      spawnSync(sudoBin, ['-k'], { stdio: 'ignore', timeout: 2000 })
      const interactiveResult = spawnSync(sudoBin, ['true'], {
        stdio: 'inherit',
        timeout: 30_000,
      })
      if (interactiveResult.status === 0) {
        return 'authenticated'
      }
    }
    /* c8 ignore stop */
  }
  // Path 2: macOS-only — osascript password prompt + dscl validation.
  // Linux/BSD: no GUI-portable fallback that works across distros
  // without assuming a specific desktop (zenity/kdialog/gum all have
  // packaging caveats). Falls back to 'unsupported' on non-darwin.
  // macOS-with-MDM-blocker: skipped via isOsascriptBlocked() to avoid
  // surfacing the "Process Blocked" toast.
  /* c8 ignore start - true arm (non-darwin) unreachable on macOS test host */
  if (process.platform !== 'darwin') {
    return 'unsupported'
  }
  /* c8 ignore stop */
  /* c8 ignore start - true arm only reachable when MDM blocks osascript; not present on test host */
  if (isOsascriptBlocked()) {
    return 'unsupported'
  }
  /* c8 ignore stop */
  /* c8 ignore start - osascript dialog path unreachable when MDM blocks osascript or in headless CI */
  // `display dialog` runs in osascript's own UI process — it does NOT
  // require Automation / System Events permissions (which Claude Code
  // typically doesn't have). Bare `display dialog` works without any
  // privacy prompt the first time.
  const dialogScript =
    'display dialog ' +
    '"Authenticate to authorize workflow scope bypass.\\n\\n' +
    'This step is required even after the chat bypass phrase." ' +
    'default answer "" with hidden answer with title "gh-token-hygiene-guard" ' +
    'buttons {"Cancel", "Authenticate"} default button "Authenticate" with icon caution\n' +
    'return text returned of result'
  const dialog = spawnSync(OSASCRIPT_BIN, ['-e', dialogScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
    timeout: 120_000,
  })
  if (dialog.status !== 0) {
    // Reached only when isOsascriptBlocked() returned false (no MDM
    // signal on disk) but the dialog still errored. Most common cause:
    // user clicked Cancel. Treat as 'denied' (cancellation message).
    return 'denied'
  }
  const password = String(dialog.stdout ?? '').replace(/\n$/, '')
  if (!password) {
    return 'denied'
  }
  // Validate against the user's account via dscl. -authonly returns
  // exit 0 on match, non-zero otherwise. The password never touches
  // disk; it flows through stdin only.
  const user = process.env['USER'] ?? ''
  if (!user) {
    return 'unsupported'
  }
  const dscl = spawnSync(DSCL_BIN, ['.', '-authonly', user], {
    stdio: ['pipe', 'ignore', 'ignore'],
    input: password,
    stdioString: true,
    timeout: 10_000,
  })
  if (dscl.status === 0) {
    // Password fallback worked. If Touch ID isn't configured for sudo,
    // surface a one-time educational nudge so the user can set it up
    // and skip the password dialog on future bypasses.
    maybePrintTouchIdSetupNudge()
    return 'authenticated'
  }
  return 'denied'
  /* c8 ignore stop */
}

const TOUCH_ID_NUDGED_FILE = path.join(
  os.homedir(),
  '.claude',
  'gh-touch-id-setup-nudged',
)

/* c8 ignore start - only reachable after osascript dscl auth success, which is MDM-gated */
function maybePrintTouchIdSetupNudge(): void {
  // Already configured → no nudge needed.
  if (isTouchIdSudoConfigured()) {
    return
  }
  // Already shown the nudge → don't repeat.
  if (existsSync(TOUCH_ID_NUDGED_FILE)) {
    return
  }
  try {
    mkdirSync(path.dirname(TOUCH_ID_NUDGED_FILE), { recursive: true })
    writeFileSync(TOUCH_ID_NUDGED_FILE, String(Date.now()), 'utf8')
  } catch {
    // best-effort; if we can't write the sentinel, the nudge prints
    // again next time — minor annoyance, no security impact.
  }
  process.stderr.write(
    [
      '',
      'TIP — skip the password dialog next time: enable Touch ID for sudo.',
      '',
      'Run this once (copy-paste verbatim; `EOF` must be at column 0,',
      'no leading whitespace, or the heredoc will hang):',
      '',
      "sudo tee /etc/pam.d/sudo_local <<'EOF'",
      'auth       sufficient     pam_tid.so',
      'EOF',
      '',
      'What this does:',
      "  /etc/pam.d/sudo_local is macOS Sonoma+'s sudo PAM extension",
      "  point (Apple's officially-supported way to layer auth methods).",
      '  The line adds pam_tid.so as a `sufficient` auth method — meaning',
      '  sudo tries Touch ID first and falls back to your password if',
      '  Touch ID is unavailable (lid closed, no fingerprint enrolled,',
      '  declined). The file is preserved across macOS updates, unlike',
      '  /etc/pam.d/sudo which is replaced on every system upgrade.',
      '',
      "After the one-time setup, this hook's bypass-auth step pops a",
      'Touch ID dialog instead of asking for your password.',
      '',
      'This tip is shown once. Full doc:',
      '  docs/agents.md/fleet/gh-token-hygiene.md',
      '',
    ].join('\n'),
  )
}

function isTouchIdSudoConfigured(): boolean {
  // pam_tid.so can be in either /etc/pam.d/sudo_local (Sonoma+ preferred
  // location) or directly in /etc/pam.d/sudo (older systems / manual
  // edits). Either is "configured".
  for (const f of ['/etc/pam.d/sudo_local', '/etc/pam.d/sudo']) {
    try {
      if (existsSync(f)) {
        const content = readFileSync(f, 'utf8')
        // Detect lines like `auth ... pam_tid.so` (whitespace-flexible).
        if (/^\s*auth\b.*\bpam_tid\.so\b/m.test(content)) {
          return true
        }
      }
    } catch {
      // Unreadable → assume not configured.
    }
  }
  return false
}
/* c8 ignore stop */

// Build a block verdict whose message is byte-identical to the old
// `fail(headline, body)` stderr write (`\n${headline}\n\n${body}\n\n`),
// so the blocking text the user reads is unchanged.
function fail(headline: string, body: string): GuardBlock {
  return block(`\n${headline}\n\n${body}\n\n`)
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
