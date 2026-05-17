/**
 * @fileoverview Wire a keychain → environment bridge into the user's
 * shell rc file so every new shell session exports `SOCKET_API_TOKEN`
 * AND `SOCKET_API_KEY` from the OS keychain.
 *
 * Why a shell-rc block instead of a wrapper script: sfw and other
 * Socket clients read their token from `process.env`, but the OS
 * keychain (macOS Keychain, Linux libsecret, Windows CredentialManager)
 * only hands the token out on explicit request. Nothing bridges the
 * two automatically — so unless the user manually exports the value
 * from the keychain each session, every Socket tool launches with an
 * empty token and the API returns 401.
 *
 * The block is delimited by canonical sentinels so re-running the
 * install script updates the block in place (no duplicate appends).
 * The block is small enough that the user can read it before sourcing.
 *
 * macOS only for now — zsh and bash. Linux's `secret-tool` works the
 * same way but the rc-detection on Linux distros varies more (system
 * vs user profile, multiple bash variants). Windows uses PowerShell
 * profiles; the equivalent is `$PROFILE.CurrentUserAllHosts`. Both
 * are tractable but out of scope for this baseline.
 *
 * Read paths are silent (best-effort). Write paths surface clear
 * errors so the install script can tell the user when the rc file
 * couldn't be touched (read-only home dir, immutable rc, etc.).
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import process from 'node:process'

// Sentinels are intentionally simple — no env-var names in the
// BEGIN/END lines so user search-replace on a token name can't
// accidentally orphan the block.
const BLOCK_BEGIN = '# BEGIN socket-cli env (managed)'
const BLOCK_END = '# END socket-cli env'

/**
 * Single-quote a value for safe inclusion in a POSIX shell `export`
 * statement. The token is a base64-ish opaque string in practice but
 * single-quoting also handles any future format that includes
 * dollar-signs, backticks, or backslashes without surprise expansion.
 *
 * POSIX single-quoted strings can contain anything except a single
 * quote. To embed a literal single quote, close the quoted span,
 * insert an escaped quote, and reopen: `it's` → `'it'\''s'`.
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * Build the managed block body. Takes the literal token value so the
 * shell never calls `security find-generic-password` (which prompts
 * for the user's macOS login password on every new shell — see the
 * 2026-05-15 incident in memory: feedback_keychain_prompts.md).
 *
 * The exports use single-quotes for safe POSIX-shell escaping.
 */
function buildBlockBody(token: string): string {
  const quoted = shellSingleQuote(token)
  return `# Token persisted by setup-security-tools install.mts.
# Rotate via: node .claude/hooks/setup-security-tools/install.mts --rotate
# Keychain copy still lives at: security find-generic-password -s socket-cli -a SOCKET_API_TOKEN
export SOCKET_API_TOKEN=${quoted}
# sfw + older socket-cli builds read the legacy env-var name.
export SOCKET_API_KEY=${quoted}`
}

/**
 * Pick the shell rc file to edit. Honors $SHELL when set; defaults to
 * the most common file for the active user's shell.
 *
 * Why .zshenv (not .zshrc) for zsh: ~/.zshrc is only sourced for
 * interactive shells. Tools that spawn zsh non-interactively
 * (Claude Code's Bash tool, IDE integrations, CI runners) skip
 * .zshrc and therefore miss the bridge. ~/.zshenv runs for every
 * zsh invocation regardless of interactive / login state, which is
 * what an env-var export actually wants. The only downside is the
 * file runs on more shells than strictly needed — but a keychain
 * lookup of a single string is cheap (~5ms) and any consumer that
 * doesn't care just ignores the var.
 *
 * For bash: ~/.bashrc is interactive, ~/.bash_profile is login.
 * Bash's BASH_ENV is the closest analog to .zshenv but it requires
 * the env var to be set ahead of time, which doesn't help us.
 * Settle for ~/.bashrc when present, fall back to ~/.bash_profile.
 * Non-interactive bash callers still need a wrapper script for now.
 *
 * Returns `undefined` when no rc file is sensible — caller falls
 * through to "tell the user what to add manually."
 */
function pickRcFile(): string | undefined {
  const home = homedir()
  const shell = process.env['SHELL'] ?? ''
  if (/zsh$/.test(shell)) {
    return path.join(home, '.zshenv')
  }
  if (/bash$/.test(shell)) {
    const bashrc = path.join(home, '.bashrc')
    if (existsSync(bashrc)) {
      return bashrc
    }
    const bashProfile = path.join(home, '.bash_profile')
    if (existsSync(bashProfile)) {
      return bashProfile
    }
    return bashrc
  }
  return undefined
}

export interface BridgeWriteResult {
  rcPath: string
  // 'inserted' = fresh block appended; 'updated' = existing block
  // body rewritten in place; 'unchanged' = block already canonical.
  outcome: 'inserted' | 'updated' | 'unchanged'
}

/**
 * Insert / update the env-var block in the user's shell rc. macOS
 * only — Linux + Windows return `undefined` (the install script
 * falls back to a one-line instruction the user can paste).
 *
 * Takes the literal token value and embeds it as a static
 * `export SOCKET_API_TOKEN='...'` (and SOCKET_API_KEY mirror) in
 * the managed block. NO keychain lookup runs from the shell — every
 * shell startup would otherwise hit a macOS Keychain auth prompt,
 * and Claude Code's Bash tool spawns a fresh shell per command, so
 * the user gets a continuous prompt stream until they revoke.
 * (Incident memory: feedback_keychain_prompts.md, 2026-05-15.)
 *
 * The keychain is still the canonical store — the rc block is a
 * one-time materialization. Next rotate writes a new block.
 *
 * Idempotent: a second call with the same token rewrites the block
 * in place rather than appending a duplicate. Different tokens
 * trigger a rewrite. The block is matched by BLOCK_BEGIN /
 * BLOCK_END sentinels so it's safe to share an rc with other
 * managed blocks (homebrew, nvm, etc.).
 */
export function installShellRcBridge(
  token: string,
): BridgeWriteResult | undefined {
  if (!token || typeof token !== 'string') {
    throw new TypeError(
      'installShellRcBridge: token must be a non-empty string',
    )
  }
  if (platform() !== 'darwin') {
    return undefined
  }
  const rcPath = pickRcFile()
  if (!rcPath) {
    return undefined
  }

  const desiredBlock = `${BLOCK_BEGIN}\n${buildBlockBody(token)}\n${BLOCK_END}`

  let existing = ''
  if (existsSync(rcPath)) {
    existing = readFileSync(rcPath, 'utf8')
  }

  // First sweep: strip any legacy block written by an earlier install
  // version. The legacy block called `security find-generic-password`
  // from the shell, which triggers a macOS Keychain auth prompt on
  // every new shell — Claude Code's Bash tool spawns one per command,
  // so the user gets a continuous prompt stream. Removing the legacy
  // block before writing the new one closes that loop without
  // double-appending.
  const legacyRe =
    /\n*# BEGIN socket-cli keychain bridge \(managed\)[\s\S]*?# END socket-cli keychain bridge\n?/g
  existing = existing.replace(legacyRe, '\n')

  // Look for an existing canonical block. Capture the BEGIN line,
  // anything up to the END line, and the END line itself.
  const blockRe = new RegExp(
    `${escapeRegExp(BLOCK_BEGIN)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}`,
  )
  const match = blockRe.exec(existing)

  if (match) {
    if (match[0] === desiredBlock) {
      return { rcPath, outcome: 'unchanged' }
    }
    const rewritten =
      existing.slice(0, match.index) +
      desiredBlock +
      existing.slice(match.index + match[0].length)
    writeFileSync(rcPath, rewritten)
    return { rcPath, outcome: 'updated' }
  }

  // No existing block — append. Prefix with a blank line if the file
  // doesn't already end with one, so the block reads cleanly against
  // whatever the previous user content was.
  const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n\n')
  const prefix = needsLeadingNewline
    ? existing.endsWith('\n')
      ? '\n'
      : '\n\n'
    : ''
  appendFileSync(rcPath, `${prefix}${desiredBlock}\n`)
  return { rcPath, outcome: 'inserted' }
}

/**
 * Remove the keychain-bridge block from the user's shell rc. Used by
 * a future `--unbridge` path; not wired into install.mts yet. Returns
 * `true` when a block was removed, `false` when no block was present.
 */
export function uninstallShellRcBridge(): boolean {
  if (platform() !== 'darwin') {
    return false
  }
  const rcPath = pickRcFile()
  if (!rcPath || !existsSync(rcPath)) {
    return false
  }
  const existing = readFileSync(rcPath, 'utf8')
  const blockRe = new RegExp(
    `\\n*${escapeRegExp(BLOCK_BEGIN)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}\\n?`,
  )
  const match = blockRe.exec(existing)
  if (!match) {
    return false
  }
  writeFileSync(
    rcPath,
    existing.slice(0, match.index) + existing.slice(match.index + match[0].length),
  )
  return true
}

/**
 * Escape characters that have special meaning in a JavaScript regex.
 * Used for the sentinel-matching regex above — the sentinels contain
 * literal parens and `→` which both round-trip safely, but a future
 * sentinel rename might add a regex metachar so the escape is here
 * to prevent that from breaking the matcher silently.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
