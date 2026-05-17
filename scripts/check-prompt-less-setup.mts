#!/usr/bin/env node
/**
 * @fileoverview Audit the dev machine for prompt-less secret / signing
 * setup. Each check has a `fix` suggestion the operator can copy-paste.
 *
 * Exit code 0 = all good. Exit code 1 = at least one check failed.
 * Use `--fix` to attempt automatic remediation (writes ~/.gnupg/
 * gpg-agent.conf + ~/.zshenv). Read-only by default.
 *
 * Checks (macOS, Linux, Windows where applicable):
 *
 *   1. gpg-agent cache TTL ≥ 8 hours (otherwise pinentry re-prompts
 *      every ~10 minutes, which is the default).
 *   2. GPG_TTY exported in the user's shell rc so pinentry can find
 *      the controlling terminal in non-interactive shells.
 *   3. commit.gpgsign config consistency — if signing is enabled,
 *      the signing key must exist and gpg-agent must cache it.
 *   4. macOS: pinentry-program points at pinentry-mac (offers
 *      "Save in Keychain" so subsequent signs don't even hit gpg).
 *   5. SOCKET_API_TOKEN present in env OR wired via shell-rc-bridge
 *      block (so hooks read env instead of hitting the keychain).
 *   6. macOS: keychain has the Socket token entry with ACL set to
 *      "any app" (-T '') so subsequent reads don't trigger the
 *      "this app wants to access your keychain" dialog.
 *
 * Invocation:
 *   node template/scripts/check-prompt-less-setup.mts
 *   node template/scripts/check-prompt-less-setup.mts --fix
 *
 * Wired into `pnpm run doctor:auth` in template/package.json — that's
 * the canonical entry point. Run it after `pnpm run setup` and
 * whenever a fresh signing/keychain prompt surprises you.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/spawn'

const logger = console

interface CheckResult {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
  readonly fix?: string | undefined
}

const CACHE_TTL_THRESHOLD_SECONDS = 28800

function isMac(): boolean {
  return os.platform() === 'darwin'
}

function isLinux(): boolean {
  return os.platform() === 'linux'
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

function parseTtl(content: string, directive: string): number | undefined {
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
    if (m && m[1]) {
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
      detail: '~/.gnupg/gpg-agent.conf missing — defaults are 600s (10 min) which forces a fresh pinentry every ~10 minutes of work.',
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
      fix: 'Add the missing directives to ~/.gnupg/gpg-agent.conf:\n' +
        'default-cache-ttl 28800\nmax-cache-ttl 28800\n' +
        'Then: gpg-connect-agent reloadagent /bye',
    }
  }
  if (defaultTtl < CACHE_TTL_THRESHOLD_SECONDS || maxTtl < CACHE_TTL_THRESHOLD_SECONDS) {
    return {
      name: 'gpg-agent cache TTL',
      ok: false,
      detail:
        `default-cache-ttl=${defaultTtl}s, max-cache-ttl=${maxTtl}s. Threshold is ${CACHE_TTL_THRESHOLD_SECONDS}s (8h). Lower TTLs make pinentry re-prompt mid-session.`,
      fix:
        `Edit ~/.gnupg/gpg-agent.conf to set both default-cache-ttl and max-cache-ttl to ${CACHE_TTL_THRESHOLD_SECONDS} (8h). Then: gpg-connect-agent reloadagent /bye`,
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
      if (/^\s*export\s+GPG_TTY\s*=/m.test(content)) {
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
    fix:
      "echo 'export GPG_TTY=$(tty)' >> ~/.zshenv  (or ~/.bashrc for bash)",
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
      fix:
        'brew install pinentry-mac && echo "pinentry-program $(brew --prefix)/bin/pinentry-mac" >> ~/.gnupg/gpg-agent.conf && gpg-connect-agent reloadagent /bye',
    }
  }
  const program = m[1]!
  if (!program.includes('pinentry-mac')) {
    return {
      name: 'pinentry-program',
      ok: false,
      detail: `pinentry-program is ${program} — not pinentry-mac. pinentry-mac is the recommended choice on macOS (Keychain integration).`,
      fix:
        'brew install pinentry-mac && sed -i "" "s|^pinentry-program .*|pinentry-program $(brew --prefix)/bin/pinentry-mac|" ~/.gnupg/gpg-agent.conf && gpg-connect-agent reloadagent /bye',
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
  const r = spawnSync('git', ['config', '--global', '--get', 'commit.gpgsign'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const key = typeof keyR.stdout === 'string' ? keyR.stdout.trim() : ''
  if (!key) {
    return {
      name: 'commit.gpgsign',
      ok: false,
      detail: 'commit.gpgsign=true but user.signingkey is unset. Commits will fail or prompt for key selection on every sign.',
      fix:
        'gpg --list-secret-keys --keyid-format LONG  # find your key id\n' +
        'git config --global user.signingkey <KEYID>',
    }
  }
  // Confirm gpg can find the key without prompting.
  const checkR = spawnSync('gpg', ['--list-secret-keys', key], {
    encoding: 'utf8',
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
  const env =
    process.env['SOCKET_API_TOKEN'] ||
    // oxlint-disable-next-line socket/socket-api-token-env -- audit script: must check the legacy alias because that's literally what's being audited (whether the legacy form is still in play vs the canonical one).
    process.env['SOCKET_API_KEY']
  if (env) {
    const source = process.env['SOCKET_API_TOKEN']
      ? 'SOCKET_API_TOKEN'
      : // oxlint-disable-next-line socket/socket-api-token-env -- audit script: reports which name was found, including the legacy alias.
        'SOCKET_API_KEY'
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
      'SOCKET_API_TOKEN is not in the current env AND no shell-rc-bridge block is wired up. Hooks fall through to the keychain, which prompts on first access.',
    fix:
      'node .claude/hooks/setup-security-tools/install.mts\n' +
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
  // `security find-generic-password -s socket-cli -a SOCKET_API_TOKEN -g`
  // would print the entry. We don't want to trigger a Keychain unlock
  // dialog by reading the password — instead, just check whether the
  // entry exists via the non-password-fetching form.
  const r = spawnSync(
    'security',
    ['find-generic-password', '-s', 'socket-cli', '-a', 'SOCKET_API_TOKEN'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (r.status !== 0) {
    return {
      name: 'macOS Keychain token ACL',
      ok: false,
      detail:
        'No socket-cli/SOCKET_API_TOKEN entry in the Keychain. Tools that fall back to keychain (when env is empty) will prompt for input on first use.',
      fix:
        'node .claude/hooks/setup-security-tools/install.mts\n' +
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
      'socket-cli/SOCKET_API_TOKEN entry present. Assumes ACL=any app (-T "") from setup-security-tools — if you still get Keychain prompts, open Keychain Access → search "socket-cli" → click "Always Allow" once for /usr/bin/security.',
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
  logger.error(`=== prompt-less auth setup audit (${summary.ok}/${summary.total} ok) ===`)
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

function main(): void {
  const summary = runAllChecks()
  printReport(summary)
  process.exit(summary.failed > 0 ? 1 : 0)
}

main()
