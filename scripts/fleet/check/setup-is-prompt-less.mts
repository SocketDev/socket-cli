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

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { envAsString } from '@socketsecurity/lib-stable/env/string'
import { readSocketApiTokenSync } from '@socketsecurity/lib-stable/secrets/socket-api-token'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import {
  CACHE_TTL_THRESHOLD_SECONDS,
  evaluateCommitGpgsign,
  evaluateGpgAgentCacheTtl,
  evaluateGpgTtyExported,
  evaluateKeychainTokenAcl,
  evaluatePinentryProgram,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  pinentryProgramIn,
} from './setup-is-prompt-less/evaluate.mts'
import type { CheckResult } from './setup-is-prompt-less/evaluate.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

const logger = console

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
  return evaluateGpgAgentCacheTtl({
    confExists: content !== undefined,
    defaultTtl:
      content === undefined
        ? undefined
        : parseTtl(content, 'default-cache-ttl'),
    maxTtl:
      content === undefined ? undefined : parseTtl(content, 'max-cache-ttl'),
  })
}

// Shell rc files a login shell sources, in the order the audit reports them.
const GPG_TTY_RC_BASENAMES: readonly string[] = [
  '.zshenv',
  '.zshrc',
  '.bashrc',
  '.bash_profile',
  '.profile',
]

/**
 * Display path of the first rc file exporting GPG_TTY, or undefined.
 */
export function findGpgTtyRcDisplayPath(home: string): string | undefined {
  for (let i = 0, { length } = GPG_TTY_RC_BASENAMES; i < length; i += 1) {
    const filePath = path.join(home, GPG_TTY_RC_BASENAMES[i]!)
    if (!existsSync(filePath)) {
      continue
    }
    try {
      if (GPG_TTY_EXPORT_RE.test(readFileSync(filePath, 'utf8'))) {
        return `~/${path.relative(home, filePath)}`
      }
    } catch {
      // Skip unreadable files.
    }
  }
  return undefined
}

function checkGpgTtyExported(): CheckResult {
  return evaluateGpgTtyExported(findGpgTtyRcDisplayPath(os.homedir()))
}

function checkPinentryProgram(): CheckResult {
  const program = pinentryProgramIn(readGpgAgentConf())
  return evaluatePinentryProgram({
    isMacOs: isMac(),
    program,
    programExists: program !== undefined && existsSync(program),
  })
}

function gitConfigGlobal(key: string): string | undefined {
  const r = spawnSync('git', ['config', '--global', '--get', key], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (r.status !== 0) {
    return undefined
  }
  return typeof r.stdout === 'string' ? r.stdout : undefined
}

function checkCommitGpgsign(): CheckResult {
  const gpgsignValue = gitConfigGlobal('commit.gpgsign')
  const signingKey = gitConfigGlobal('user.signingkey')
  // Only probe gpg when a key is actually configured — the spawn is the
  // expensive part and the verdict ignores it otherwise.
  const key = signingKey?.trim() ?? ''
  const gpgFindsKey =
    key === ''
      ? false
      : spawnSync('gpg', ['--list-secret-keys', key], {
          stdio: ['ignore', 'pipe', 'pipe'],
        }).status === 0
  return evaluateCommitGpgsign({ gpgFindsKey, gpgsignValue, signingKey })
}

/**
 * What the token audit needs to reach a verdict, with the reads already done.
 *
 * Split out so the decision is testable without a real HOME, a real shell rc,
 * or a real environment: `checkSocketTokenInEnv` does the I/O and this decides.
 */
export interface SocketTokenEnvInputs {
  // `SOCKET_API_KEY`, the primary slot.
  readonly apiKey: string | undefined
  // `SOCKET_API_TOKEN`, the fallback slot.
  readonly apiToken: string | undefined
  // Display path of the first shell rc carrying the bridge block, if any.
  readonly bridgeRcDisplayPath: string | undefined
}

/**
 * Decide the "Socket API token in env" verdict.
 *
 * Reports the env name that is ACTUALLY set. The earlier form inverted the two
 * labels — with `SOCKET_API_TOKEN` set it announced `SOCKET_API_KEY` and vice
 * versa — so an operator following the audit would go looking at the wrong
 * variable.
 *
 * Precedence is `SOCKET_API_TOKEN` then `SOCKET_API_KEY`, mirroring
 * socket-lib's `TOKEN_ACCOUNTS` order: TOKEN is canonical and KEY is the legacy
 * alias. The earlier `SOCKET_API_KEY || SOCKET_API_TOKEN` had that backwards
 * too, so with both set the audit described a different value than the one
 * every other consumer resolves.
 */
export function evaluateSocketTokenInEnv(
  inputs: SocketTokenEnvInputs,
): CheckResult {
  const name = 'Socket API token in env'
  // `envAsString` normalizes before the existence test: a slot set to
  // whitespace is NOT configured, but a raw truthiness check would call `'   '`
  // a token and report a passing audit with a length of 3.
  const token = envAsString(inputs.apiToken)
  const key = envAsString(inputs.apiKey)
  const value = token || key
  if (value) {
    // oxlint-disable-next-line socket/socket-api-token-env -- audit output: names the raw slot the operator actually populated, so the legacy alias has to appear verbatim.
    const source = token ? 'SOCKET_API_TOKEN' : 'SOCKET_API_KEY'
    return {
      detail: `${source} set (length ${value.length}). Hooks read env first; no keychain prompts.`,
      name,
      ok: true,
    }
  }
  if (inputs.bridgeRcDisplayPath !== undefined) {
    return {
      detail: `not set in current shell, but shell-rc-bridge block exists in ${inputs.bridgeRcDisplayPath} — fresh shells will export it.`,
      name,
      ok: true,
    }
  }
  return {
    detail:
      'SOCKET_API_KEY is not in the current env AND no shell-rc-bridge block is wired up. Hooks fall through to the keychain, which prompts on first access.',
    fix:
      'node .claude/hooks/fleet/setup-security-tools/install.mts\n' +
      '  # installs the shell-rc-bridge block; exports the token in every fresh shell',
    name,
    ok: false,
  }
}

// The shell rc files a fresh login shell sources, in the order the bridge block
// would be found.
const SHELL_RC_BASENAMES: readonly string[] = [
  '.zshenv',
  '.zshrc',
  '.bashrc',
  '.bash_profile',
]

/**
 * Display path of the first shell rc carrying the bridge block, or undefined.
 */
export function findBridgeRcDisplayPath(home: string): string | undefined {
  for (let i = 0, { length } = SHELL_RC_BASENAMES; i < length; i += 1) {
    const filePath = path.join(home, SHELL_RC_BASENAMES[i]!)
    if (!existsSync(filePath)) {
      continue
    }
    try {
      if (readFileSync(filePath, 'utf8').includes('# BEGIN socket-cli env')) {
        return `~/${path.relative(home, filePath)}`
      }
    } catch {
      // Skip unreadable files.
    }
  }
  return undefined
}

function checkSocketTokenInEnv(): CheckResult {
  // `allowEnvOnly` is the whole point: this audit reports whether the raw env
  // slots are wired up, and the default keychain fallback would answer "found"
  // for an empty environment — reporting success for exactly the state the
  // audit exists to catch. It also keeps the audit from triggering the Keychain
  // prompt it is checking for.
  const resolved = readSocketApiTokenSync({ allowEnvOnly: true })
  // The raw slots decide only the LABEL — `resolved` above is the presence
  // verdict, so the audit and every other consumer agree on the value. Read on
  // their own lines so each suppression marker stays adjacent to its read even
  // after the formatter wraps the surrounding call.
  // `getEnvValue` rather than `process.env`: it is the fleet's rewirable env
  // accessor, so `withEnv` / `setEnv` / `vi.stubEnv` reach these reads the same
  // way they reach every other getter.
  // socket-api-token-getter: allow direct-env -- audit names which raw slot the operator populated.
  // oxlint-disable-next-line socket/socket-api-token-env -- audit script: the legacy alias is the thing being audited.
  const rawKey = getEnvValue('SOCKET_API_KEY')
  // socket-api-token-getter: allow direct-env -- audit names which raw slot the operator populated.
  const rawToken = getEnvValue('SOCKET_API_TOKEN')
  return evaluateSocketTokenInEnv({
    apiKey: resolved === undefined ? undefined : rawKey,
    apiToken: resolved === undefined ? undefined : rawToken,
    bridgeRcDisplayPath: findBridgeRcDisplayPath(os.homedir()),
  })
}

function checkKeychainTokenAcl(): CheckResult {
  if (!isMac()) {
    return evaluateKeychainTokenAcl({ entryFound: false, isMacOs: false })
  }
  // The password-fetching form (`-g`) would pop a Keychain unlock dialog — the
  // exact prompt this audit exists to eliminate. The plain lookup only asks
  // whether the entry exists.
  const r = spawnSync(
    'security',
    ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  return evaluateKeychainTokenAcl({
    entryFound: r.status === 0,
    isMacOs: true,
  })
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

export function lastEffectiveIndex(
  lines: readonly string[],
  re: RegExp,
): number {
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
export function upsertDirectiveLine(
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
export function pinentrySatisfied(confContent: string | undefined): boolean {
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

const SCRIPT_META: ScriptMeta = {
  describe: 'audits the dev machine for prompt-less secret and signing setup',
  help: `Usage: node scripts/fleet/check/setup-is-prompt-less.mts [flags]
  --fix  apply the mechanical remediations (gpg-agent cache TTLs, pinentry-program, GPG_TTY export)`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
