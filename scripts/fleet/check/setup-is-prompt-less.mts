#!/usr/bin/env node
/*
 * @file Audit the dev machine for prompt-less secret / signing setup. Each
 *   check has a `fix` suggestion the operator can copy-paste. Exit code 0 = all
 *   good. Exit code 1 = at least one check failed. Use `--fix` to attempt
 *   automatic remediation of the MECHANICAL parts only: cache-TTL directives
 *   and (macOS, when the binary is already installed) pinentry-program in
 *   ~/.gnupg/gpg-agent.conf — created if missing, `gpg-connect-agent
 *   reloadagent /bye` afterward — plus `export GPG_TTY=$(tty)` in ~/.zshenv.
 *   All writes are idempotent (re-running never duplicates a line).
 *   Judgment- or human-shaped steps are reported, never attempted:
 *   installing pinentry-mac (`brew install pinentry-mac`), choosing a git
 *   signing key, the Keychain Access "Always Allow" click, and the
 *   interactive Socket token install.
 *   Read-only by default. Checks (macOS, Linux, Windows where applicable):
 *
 *   1. gpg-agent cache TTL ≥ 8 hours (otherwise pinentry re-prompts every ~10
 *      minutes, which is the default).
 *   2. GPG_TTY exported in the user's shell rc so pinentry can find the
 *      controlling terminal in non-interactive shells.
 *   3. commit.gpgsign config consistency — if signing is enabled, the signing key
 *      must exist and gpg-agent must cache it.
 *   4. macOS: pinentry-program points at pinentry-mac (offers "Save in Keychain"
 *      so subsequent signs don't even hit gpg).
 *   5. SOCKET_API_KEY present in env OR wired via shell-rc-bridge block (so hooks
 *      read env instead of hitting the keychain).
 *   6. macOS: keychain has the Socket token entry with ACL set to "any app" (-T
 *      '') so subsequent reads don't trigger the "this app wants to access your
 *      keychain" dialog. Invocation: node
 *      scripts/fleet/check/setup-is-prompt-less.mts node
 *      scripts/fleet/check/setup-is-prompt-less.mts --fix Wired into `pnpm run
 *      doctor:auth` in package.json — that's the canonical entry
 *      point. Run it after `pnpm run setup` and whenever a fresh
 *      signing/keychain prompt surprises you.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { isMainModule } from '../_shared/is-main-module.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

const logger = console

interface CheckResult {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
  readonly fix?: string | undefined
}

const CACHE_TTL_THRESHOLD_SECONDS = 28_800

// Shared between the audit and the --fix planner so they can never disagree
// about what "GPG_TTY is exported" means.
const GPG_TTY_EXPORT_RE = /^\s*export\s+GPG_TTY\s*=/m
const GPG_TTY_EXPORT_LINE = 'export GPG_TTY=$(tty)'

export function isMac(): boolean {
  return os.platform() === 'darwin'
}

function readGpgAgentConf(): string | undefined {
  const confPath = path.join(os.homedir(), '.gnupg', 'gpg-agent.conf')
  if (!existsSync(confPath)) {
    return undefined
  }
  try {
    return readFileSync(confPath, 'utf8')
  } catch {
    return undefined
  }
}

export function parseTtl(
  content: string,
  directive: string,
): number | undefined {
  // gpg-agent.conf supports comments via `#`; directives are
  // `directive value` on a line. Take the LAST occurrence (gpg-agent
  // semantics: later wins on duplicates).
  const lines = content.split('\n')
  let match: number | undefined
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const ln = lines[i]!.trim()
    if (ln.startsWith('#') || !ln) {
      continue
    }
    const re = new RegExp(`^${directive}\\s+(\\d+)\\s*(?:#.*)?$`)
    const m = re.exec(ln)
    if (m?.[1]) {
      match = Number(m[1])
    }
  }
  return match
}

function checkGpgAgentCacheTtl(): CheckResult {
  const content = readGpgAgentConf()
  if (!content) {
    return {
      name: 'gpg-agent cache TTL',
      ok: false,
      detail:
        '~/.gnupg/gpg-agent.conf missing — defaults are 600s (10 min) which forces a fresh pinentry every ~10 minutes of work.',
      fix:
        'mkdir -p ~/.gnupg && cat >> ~/.gnupg/gpg-agent.conf <<EOF\n' +
        'default-cache-ttl 28800\n' +
        'max-cache-ttl 28800\n' +
        'default-cache-ttl-ssh 28800\n' +
        'max-cache-ttl-ssh 28800\n' +
        'EOF\n' +
        'gpg-connect-agent reloadagent /bye',
    }
  }
  const defaultTtl = parseTtl(content, 'default-cache-ttl')
  const maxTtl = parseTtl(content, 'max-cache-ttl')
  if (defaultTtl === undefined || maxTtl === undefined) {
    return {
      name: 'gpg-agent cache TTL',
      ok: false,
      detail: `gpg-agent.conf exists but is missing ${[
        defaultTtl === undefined ? 'default-cache-ttl' : '',
        maxTtl === undefined ? 'max-cache-ttl' : '',
      ]
        .filter(Boolean)
        .join(' + ')}; gpg-agent falls back to 600s defaults.`,
      fix:
        'Add the missing directives to ~/.gnupg/gpg-agent.conf:\n' +
        'default-cache-ttl 28800\nmax-cache-ttl 28800\n' +
        'Then: gpg-connect-agent reloadagent /bye',
    }
  }
  if (
    defaultTtl < CACHE_TTL_THRESHOLD_SECONDS ||
    maxTtl < CACHE_TTL_THRESHOLD_SECONDS
  ) {
    return {
      name: 'gpg-agent cache TTL',
      ok: false,
      detail: `default-cache-ttl=${defaultTtl}s, max-cache-ttl=${maxTtl}s. Threshold is ${CACHE_TTL_THRESHOLD_SECONDS}s (8h). Lower TTLs make pinentry re-prompt mid-session.`,
      fix: `Edit ~/.gnupg/gpg-agent.conf to set both default-cache-ttl and max-cache-ttl to ${CACHE_TTL_THRESHOLD_SECONDS} (8h). Then: gpg-connect-agent reloadagent /bye`,
    }
  }
  return {
    name: 'gpg-agent cache TTL',
    ok: true,
    detail: `default=${defaultTtl}s, max=${maxTtl}s (both ≥ ${CACHE_TTL_THRESHOLD_SECONDS}s threshold).`,
  }
}

function checkGpgTtyExported(): CheckResult {
  // Two places to look: ~/.zshenv (preferred — runs for every zsh) and
  // ~/.bashrc / ~/.bash_profile (bash). The check just needs to see
  // `GPG_TTY` exported somewhere reachable.
  const candidates = [
    path.join(os.homedir(), '.zshenv'),
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.bash_profile'),
    path.join(os.homedir(), '.profile'),
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const f = candidates[i]!
    if (!existsSync(f)) {
      continue
    }
    try {
      const content = readFileSync(f, 'utf8')
      if (GPG_TTY_EXPORT_RE.test(content)) {
        return {
          name: 'GPG_TTY exported in shell rc',
          ok: true,
          detail: `found 'export GPG_TTY=...' in ${path.relative(os.homedir(), f).replace(/^/, '~/')}.`,
        }
      }
    } catch {
      // Skip unreadable files.
    }
  }
  return {
    name: 'GPG_TTY exported in shell rc',
    ok: false,
    detail:
      'No `export GPG_TTY=$(tty)` found in ~/.zshenv / ~/.zshrc / ~/.bashrc / ~/.bash_profile / ~/.profile. pinentry needs GPG_TTY to find the controlling terminal in non-interactive shells (Claude Code, IDE integrations).',
    fix: "echo 'export GPG_TTY=$(tty)' >> ~/.zshenv  (or ~/.bashrc for bash)",
  }
}

function checkPinentryProgram(): CheckResult {
  if (!isMac()) {
    return {
      name: 'pinentry-program',
      ok: true,
      detail: 'skipped (non-macOS).',
    }
  }
  const content = readGpgAgentConf() ?? ''
  const m = /^\s*pinentry-program\s+(\S+)/m.exec(content)
  if (!m) {
    return {
      name: 'pinentry-program',
      ok: false,
      detail:
        'No `pinentry-program` set in ~/.gnupg/gpg-agent.conf. pinentry-mac integrates with macOS Keychain ("Save in Keychain" checkbox); without it, gpg may use a less-friendly fallback.',
      fix: 'brew install pinentry-mac && echo "pinentry-program $(brew --prefix)/bin/pinentry-mac" >> ~/.gnupg/gpg-agent.conf && gpg-connect-agent reloadagent /bye',
    }
  }
  const program = m[1]!
  if (!program.includes('pinentry-mac')) {
    return {
      name: 'pinentry-program',
      ok: false,
      detail: `pinentry-program is ${program} — not pinentry-mac. pinentry-mac is the recommended choice on macOS (Keychain integration).`,
      fix: 'brew install pinentry-mac && sed -i "" "s|^pinentry-program .*|pinentry-program $(brew --prefix)/bin/pinentry-mac|" ~/.gnupg/gpg-agent.conf && gpg-connect-agent reloadagent /bye',
    }
  }
  if (!existsSync(program)) {
    return {
      name: 'pinentry-program',
      ok: false,
      detail: `pinentry-program points at ${program} but that file doesn't exist.`,
      fix: 'brew install pinentry-mac  # restores the binary at the expected path',
    }
  }
  return {
    name: 'pinentry-program',
    ok: true,
    detail: `${program} (pinentry-mac, Keychain-integrated).`,
  }
}

function checkCommitGpgsign(): CheckResult {
  const r = spawnSync(
    'git',
    ['config', '--global', '--get', 'commit.gpgsign'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const value = typeof r.stdout === 'string' ? r.stdout.trim() : ''
  if (r.status !== 0 || !value) {
    return {
      name: 'commit.gpgsign',
      ok: true,
      detail: 'unset (no signing → no prompts; nothing to optimize).',
    }
  }
  if (value !== 'true') {
    return {
      name: 'commit.gpgsign',
      ok: true,
      detail: `${value} (signing disabled; nothing to optimize).`,
    }
  }
  // Signing IS on globally. Check the key exists.
  const keyR = spawnSync(
    'git',
    ['config', '--global', '--get', 'user.signingkey'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const key = typeof keyR.stdout === 'string' ? keyR.stdout.trim() : ''
  if (!key) {
    return {
      name: 'commit.gpgsign',
      ok: false,
      detail:
        'commit.gpgsign=true but user.signingkey is unset. Commits will fail or prompt for key selection on every sign.',
      fix:
        'gpg --list-secret-keys --keyid-format LONG  # find your key id\n' +
        'git config --global user.signingkey <KEYID>',
    }
  }
  // Confirm gpg can find the key without prompting.
  const checkR = spawnSync('gpg', ['--list-secret-keys', key], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (checkR.status !== 0) {
    return {
      name: 'commit.gpgsign',
      ok: false,
      detail: `signing key ${key} is configured but gpg can't find it. Every sign will fail.`,
      fix:
        `gpg --list-secret-keys --keyid-format LONG  # confirm or pick another key\n` +
        `git config --global user.signingkey <KEYID>`,
    }
  }
  return {
    name: 'commit.gpgsign',
    ok: true,
    detail: `enabled, key ${key} found.`,
  }
}

function checkSocketTokenInEnv(): CheckResult {
  // This audit reports whether the raw env slots are wired up; the
  // keychain-fallback getter would defeat the check.
  const env =
    // socket-api-token-getter: allow direct-env
    // oxlint-disable-next-line socket/socket-api-token-env -- audit script: must check the primary slot because that's literally what's being audited, whether the install hook's primary export is wired up.
    process.env['SOCKET_API_KEY'] || process.env['SOCKET_API_TOKEN']
  if (env) {
    // socket-api-token-getter: allow direct-env -- audit reports which raw env name is set.
    const source = process.env['SOCKET_API_TOKEN']
      ? // oxlint-disable-next-line socket/socket-api-token-env -- audit script: reports which name was found, including the primary slot.
        'SOCKET_API_KEY'
      : 'SOCKET_API_TOKEN'
    return {
      name: 'Socket API token in env',
      ok: true,
      detail: `${source} set (length ${env.length}). Hooks read env first; no keychain prompts.`,
    }
  }
  // Token not in env — check if the shell-rc-bridge block is wired up.
  const rcFiles = [
    path.join(os.homedir(), '.zshenv'),
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.bash_profile'),
  ]
  for (let i = 0, { length } = rcFiles; i < length; i += 1) {
    const f = rcFiles[i]!
    if (!existsSync(f)) {
      continue
    }
    try {
      const content = readFileSync(f, 'utf8')
      if (content.includes('# BEGIN socket-cli env')) {
        return {
          name: 'Socket API token in env',
          ok: true,
          detail: `not set in current shell, but shell-rc-bridge block exists in ${path.relative(os.homedir(), f).replace(/^/, '~/')} — fresh shells will export it.`,
        }
      }
    } catch {
      // Skip unreadable files.
    }
  }
  return {
    name: 'Socket API token in env',
    ok: false,
    detail:
      'SOCKET_API_KEY is not in the current env AND no shell-rc-bridge block is wired up. Hooks fall through to the keychain, which prompts on first access.',
    fix:
      'node .claude/hooks/fleet/setup-security-tools/install.mts\n' +
      '  # installs the shell-rc-bridge block; exports the token in every fresh shell',
  }
}

function checkKeychainTokenAcl(): CheckResult {
  if (!isMac()) {
    return {
      name: 'macOS Keychain token ACL',
      ok: true,
      detail: 'skipped (non-macOS).',
    }
  }
  // `security find-generic-password -s socket-cli -a SOCKET_API_KEY -g`
  // would print the entry. We don't want to trigger a Keychain unlock
  // dialog by reading the password — instead, just check whether the
  // entry exists via the non-password-fetching form.
  const r = spawnSync(
    'security',
    ['find-generic-password', '-s', 'socket-cli', '-a', 'SOCKET_API_TOKEN'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status !== 0) {
    return {
      name: 'macOS Keychain token ACL',
      ok: false,
      detail:
        'No socket-cli/SOCKET_API_KEY entry in the Keychain. Tools that fall back to keychain (when env is empty) will prompt for input on first use.',
      fix:
        'node .claude/hooks/fleet/setup-security-tools/install.mts\n' +
        '  # prompts for the token interactively and persists it to the Keychain with -T "" (any app can read).',
    }
  }
  // Entry exists. We can't programmatically inspect the ACL without
  // triggering an unlock prompt; trust that setup-security-tools wrote
  // it with `-T ''`. Report as OK with a note.
  return {
    name: 'macOS Keychain token ACL',
    ok: true,
    detail:
      'socket-cli/SOCKET_API_KEY entry present. Assumes ACL=any app (-T "") from setup-security-tools — if you still get Keychain prompts, open Keychain Access → search "socket-cli" → click "Always Allow" once for /usr/bin/security.',
  }
}

interface CheckSummary {
  total: number
  ok: number
  failed: number
  results: CheckResult[]
}

function runAllChecks(): CheckSummary {
  const results: CheckResult[] = [
    checkGpgAgentCacheTtl(),
    checkGpgTtyExported(),
    checkPinentryProgram(),
    checkCommitGpgsign(),
    checkSocketTokenInEnv(),
    checkKeychainTokenAcl(),
  ]
  const ok = results.filter(r => r.ok).length
  return {
    total: results.length,
    ok,
    failed: results.length - ok,
    results,
  }
}

function printReport(summary: CheckSummary): void {
  logger.error('')
  logger.error(
    `=== prompt-less auth setup audit (${summary.ok}/${summary.total} ok) ===`,
  )
  for (let i = 0, { length } = summary.results; i < length; i += 1) {
    const r = summary.results[i]!
    const status = r.ok ? '[ok]  ' : '[FAIL]'
    logger.error('')
    logger.error(`${status} ${r.name}`)
    logger.error(`       ${r.detail}`)
    if (!r.ok && r.fix) {
      logger.error('')
      logger.error('       fix:')
      const fixLines = r.fix.split('\n')
      for (let j = 0, l = fixLines.length; j < l; j += 1) {
        logger.error(`         ${fixLines[j]!}`)
      }
    }
  }
  logger.error('')
}

// --- `--fix` machinery ------------------------------------------------------
//
// The planners below are PURE: current file contents in, planned writes out.
// They never touch the filesystem, so tests exercise them with in-memory
// strings and fake paths. Only the thin `runFix()` executor at the bottom
// reads/writes real files, and every path it uses comes from
// `resolveFixPaths(home)` — nothing below hardcodes $HOME.

export interface PlannedWrite {
  readonly path: string
  readonly content: string
  readonly changes: readonly string[]
}

export interface FixPaths {
  readonly gnupgDir: string
  readonly gpgAgentConfPath: string
  readonly zshenvPath: string
  readonly otherRcPaths: readonly string[]
}

export function resolveFixPaths(home: string): FixPaths {
  const gnupgDir = path.join(home, '.gnupg')
  return {
    gnupgDir,
    gpgAgentConfPath: path.join(gnupgDir, 'gpg-agent.conf'),
    zshenvPath: path.join(home, '.zshenv'),
    otherRcPaths: [
      path.join(home, '.zshrc'),
      path.join(home, '.bashrc'),
      path.join(home, '.bash_profile'),
      path.join(home, '.profile'),
    ],
  }
}

const GPG_AGENT_TTL_DIRECTIVES = ['default-cache-ttl', 'max-cache-ttl']

function lastEffectiveIndex(lines: readonly string[], re: RegExp): number {
  let idx = -1
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const ln = lines[i]!.trim()
    if (!ln || ln.startsWith('#')) {
      continue
    }
    if (re.test(ln)) {
      idx = i
    }
  }
  return idx
}

/**
 * Rewrite the LAST effective occurrence of a directive (gpg-agent semantics:
 * later wins on duplicates), or append it when absent. Never duplicates.
 */
function upsertDirectiveLine(
  lines: string[],
  re: RegExp,
  desired: string,
): void {
  const idx = lastEffectiveIndex(lines, re)
  if (idx === -1) {
    lines.push(desired)
  } else {
    lines[idx] = desired
  }
}

/**
 * Pure planner for ~/.gnupg/gpg-agent.conf. `content` is the current file
 * content (undefined = file missing). `pinentryMacPath` is the absolute path
 * of an ALREADY-INSTALLED pinentry-mac binary the conf should point at, or
 * undefined to leave pinentry-program alone (non-macOS, binary absent, or
 * the existing line already satisfies the check). Returns the full rewritten
 * content, or undefined when no write is needed. Idempotent: too-low or
 * wrong directives are rewritten in place, missing ones appended once.
 */
export function planGpgAgentConfFix(
  confPath: string,
  content: string | undefined,
  pinentryMacPath: string | undefined,
): PlannedWrite | undefined {
  const changes: string[] = []
  if (content === undefined) {
    // Fresh file: write exactly what the check's copy-paste fix prescribes.
    const lines = [
      'default-cache-ttl 28800',
      'max-cache-ttl 28800',
      'default-cache-ttl-ssh 28800',
      'max-cache-ttl-ssh 28800',
    ]
    changes.push('created with 8h (28800s) cache-TTL directives')
    if (pinentryMacPath) {
      lines.push(`pinentry-program ${pinentryMacPath}`)
      changes.push(`set pinentry-program ${pinentryMacPath}`)
    }
    return { path: confPath, content: `${lines.join('\n')}\n`, changes }
  }
  const lines = content.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  for (let i = 0, { length } = GPG_AGENT_TTL_DIRECTIVES; i < length; i += 1) {
    const directive = GPG_AGENT_TTL_DIRECTIVES[i]!
    const current = parseTtl(content, directive)
    if (current !== undefined && current >= CACHE_TTL_THRESHOLD_SECONDS) {
      continue
    }
    const desired = `${directive} ${CACHE_TTL_THRESHOLD_SECONDS}`
    upsertDirectiveLine(lines, new RegExp(`^${directive}\\s`), desired)
    changes.push(
      current === undefined
        ? `added \`${desired}\``
        : `raised ${directive} from ${current} to ${CACHE_TTL_THRESHOLD_SECONDS}`,
    )
  }
  if (pinentryMacPath) {
    const re = /^pinentry-program\s/
    const idx = lastEffectiveIndex(lines, re)
    const effective =
      idx === -1
        ? undefined
        : /^pinentry-program\s+(\S+)/.exec(lines[idx]!.trim())?.[1]
    if (effective !== pinentryMacPath) {
      upsertDirectiveLine(lines, re, `pinentry-program ${pinentryMacPath}`)
      changes.push(`set pinentry-program ${pinentryMacPath}`)
    }
  }
  if (changes.length === 0) {
    return undefined
  }
  return { path: confPath, content: `${lines.join('\n')}\n`, changes }
}

/**
 * Pure planner for the GPG_TTY export. Mirrors the audit: satisfied when ANY
 * candidate rc file already exports GPG_TTY; otherwise appends the export
 * line to ~/.zshenv (created if missing). Idempotent: never duplicates.
 */
export function planGpgTtyFix(
  zshenvPath: string,
  zshenvContent: string | undefined,
  otherRcContents: ReadonlyArray<string | undefined>,
): PlannedWrite | undefined {
  if (zshenvContent !== undefined && GPG_TTY_EXPORT_RE.test(zshenvContent)) {
    return undefined
  }
  for (let i = 0, { length } = otherRcContents; i < length; i += 1) {
    const c = otherRcContents[i]
    if (c !== undefined && GPG_TTY_EXPORT_RE.test(c)) {
      return undefined
    }
  }
  const base =
    zshenvContent === undefined || zshenvContent === ''
      ? ''
      : zshenvContent.endsWith('\n')
        ? zshenvContent
        : `${zshenvContent}\n`
  return {
    path: zshenvPath,
    content: `${base}${GPG_TTY_EXPORT_LINE}\n`,
    changes: [`appended \`${GPG_TTY_EXPORT_LINE}\``],
  }
}

export interface FixPlanInput {
  readonly gpgAgentConfPath: string
  readonly gpgAgentConfContent: string | undefined
  readonly zshenvPath: string
  readonly zshenvContent: string | undefined
  readonly otherRcContents: ReadonlyArray<string | undefined>
  // Absolute path of an existing pinentry-mac binary to wire into the conf,
  // or undefined to leave pinentry-program alone.
  readonly pinentryMacPath: string | undefined
  // macOS, pinentry-program unsatisfied, and no pinentry-mac binary found —
  // installing it is the operator's call, so it lands in `manual`.
  readonly pinentryMacMissing: boolean
}

export interface FixPlan {
  readonly writes: readonly PlannedWrite[]
  readonly reloadGpgAgent: boolean
  readonly manual: readonly string[]
}

export function planFixes(input: FixPlanInput): FixPlan {
  const writes: PlannedWrite[] = []
  const manual: string[] = []
  const confWrite = planGpgAgentConfFix(
    input.gpgAgentConfPath,
    input.gpgAgentConfContent,
    input.pinentryMacPath,
  )
  if (confWrite) {
    writes.push(confWrite)
  }
  const ttyWrite = planGpgTtyFix(
    input.zshenvPath,
    input.zshenvContent,
    input.otherRcContents,
  )
  if (ttyWrite) {
    writes.push(ttyWrite)
  }
  if (input.pinentryMacMissing) {
    manual.push(
      'brew install pinentry-mac  # binary is absent; install it, then re-run --fix to wire gpg-agent.conf',
    )
  }
  return { writes, reloadGpgAgent: confWrite !== undefined, manual }
}

// --- `--fix` executor — the only part that touches the real filesystem ------

function readIfExists(p: string): string | undefined {
  if (!existsSync(p)) {
    return undefined
  }
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Same satisfaction rule as checkPinentryProgram, against injected content.
 */
function pinentrySatisfied(confContent: string | undefined): boolean {
  const m = /^\s*pinentry-program\s+(\S+)/m.exec(confContent ?? '')
  return m !== null && m[1]!.includes('pinentry-mac') && existsSync(m[1]!)
}

function resolvePinentryMac(): string | undefined {
  const candidates: string[] = []
  const brew = spawnSync('brew', ['--prefix'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = typeof brew.stdout === 'string' ? brew.stdout.trim() : ''
  if (brew.status === 0 && prefix) {
    candidates.push(path.join(prefix, 'bin', 'pinentry-mac'))
  }
  candidates.push(
    '/opt/homebrew/bin/pinentry-mac',
    '/usr/local/bin/pinentry-mac',
  )
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const c = candidates[i]!
    if (existsSync(c)) {
      return c
    }
  }
  return undefined
}

function runFix(paths: FixPaths): void {
  const confContent = readIfExists(paths.gpgAgentConfPath)
  let pinentryMacPath: string | undefined
  let pinentryMacMissing = false
  if (isMac() && !pinentrySatisfied(confContent)) {
    pinentryMacPath = resolvePinentryMac()
    pinentryMacMissing = pinentryMacPath === undefined
  }
  const otherRcContents: Array<string | undefined> = []
  for (let i = 0, { length } = paths.otherRcPaths; i < length; i += 1) {
    otherRcContents.push(readIfExists(paths.otherRcPaths[i]!))
  }
  const plan = planFixes({
    gpgAgentConfPath: paths.gpgAgentConfPath,
    gpgAgentConfContent: confContent,
    zshenvPath: paths.zshenvPath,
    zshenvContent: readIfExists(paths.zshenvPath),
    otherRcContents,
    pinentryMacPath,
    pinentryMacMissing,
  })
  logger.error('')
  logger.error('=== prompt-less auth setup --fix (mechanical parts only) ===')
  if (plan.writes.length === 0) {
    logger.error('  nothing mechanical to change.')
  }
  for (let i = 0, { length } = plan.writes; i < length; i += 1) {
    const w = plan.writes[i]!
    mkdirSync(path.dirname(w.path), { recursive: true, mode: 0o700 })
    writeThroughMirrorLock(w.path, w.content)
    for (let j = 0, l = w.changes.length; j < l; j += 1) {
      logger.error(`  changed ${w.path}: ${w.changes[j]!}`)
    }
  }
  if (plan.reloadGpgAgent) {
    const r = spawnSync('gpg-connect-agent', ['reloadagent', '/bye'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    logger.error(
      r.status === 0
        ? '  ran `gpg-connect-agent reloadagent /bye`'
        : '  WARN: `gpg-connect-agent reloadagent /bye` failed — run it by hand so the agent picks up the new conf.',
    )
  }
  for (let i = 0, { length } = plan.manual; i < length; i += 1) {
    logger.error(`  manual: ${plan.manual[i]!}`)
  }
  logger.error('')
  logger.error(
    '  Re-auditing. Anything still [FAIL] below needs a human (installing',
  )
  logger.error(
    '  pinentry-mac, picking a signing key, Keychain "Always Allow", the',
  )
  logger.error('  interactive token install):')
  const summary = runAllChecks()
  printReport(summary)
  process.exit(summary.failed > 0 ? 1 : 0)
}

function main(): void {
  if (process.argv.includes('--fix')) {
    runFix(resolveFixPaths(os.homedir()))
    return
  }
  const summary = runAllChecks()
  printReport(summary)
  process.exit(summary.failed > 0 ? 1 : 0)
}

if (isMainModule(import.meta.url)) {
  main()
}
