#!/usr/bin/env node
// Claude Code PreToolUse hook — npmrc-trust-optout-guard.
//
// Blocks the supply-chain escape hatch that pnpm 10.34.2 / 11.5.3 left when it
// made `${ENV_VAR}` expansion in repo-controlled credential settings
// trust-aware (refuse-by-default). Two env vars DISABLE that protection for a
// checkout and re-open token exfiltration via a malicious repo `.npmrc`:
//
//   - PNPM_CONFIG_NPMRC_AUTH_FILE   (pnpm v11)
//   - NPM_CONFIG_USERCONFIG=.npmrc  (v10 fallback, repo-local path)
//
// Two trigger surfaces:
//
//   1. Bash — a command that sets/exports either var (`FOO=… cmd`,
//      `export FOO=…`, bare `FOO=…`). AST-parsed via _shared/shell-command.mts
//      (per the no-command-regex-in-hooks rule), so the assignment is read off
//      parsed command segments, not a raw-string regex.
//   2. Edit/Write — landing either var into a committed config / script /
//      workflow file (`.npmrc`, `*.sh`, `*.mts`/`*.ts`, `.github/**`,
//      `Dockerfile`, `*.yml`/`*.yaml`, dotenv), OR introducing a `${ENV}`
//      placeholder beside `_authToken=` / `registry=` / `:registry=` in a
//      committed `.npmrc` (the exfiltration shape the pnpm change refuses to
//      expand — committing it is the credential-theft setup).
//
// All detection lives in _shared/npmrc-trust.mts — the SAME module the
// commit-time trust-gates-are-not-weakened.mts check consumes, so the edit-time
// and commit-time surfaces never drift (code is law, DRY).
//
// Bypass: `Allow npmrc-trust-optout bypass` typed verbatim in a recent user
// turn. The only legitimate case is a CI image that builds exclusively trusted
// first-party repos — rare; the protection should stay on everywhere else.
//
// Exit codes: 0 — pass (or unconsumed bypass, or any hook error → fail-open);
// 2 — block.

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  detectAuthEnvPlaceholderInNpmrc,
  detectOptoutInCommands,
  detectOptoutInFileText,
} from '../_shared/npmrc-trust.mts'
import {
  readCommand,
  readFilePath,
  readPayload,
  readWriteContent,
} from '../_shared/payload.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASES = ['Allow npmrc-trust-optout bypass']

// Committed file shapes where landing the opt-out env var is a persisted
// disabling of the protection. A scratch `.env` outside source control is not
// our concern; these are the tracked surfaces that ship the hole to others.
const COMMITTED_FILE_RE =
  /(?:^|\/)(?:\.npmrc|Dockerfile|[^/]+\.(?:sh|bash|zsh|mts|ts|cts|mjs|cjs|js|ya?ml|env))$/
const WORKFLOW_DIR_RE = /\.github\//

function isCommittedConfigFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return COMMITTED_FILE_RE.test(normalized) || WORKFLOW_DIR_RE.test(normalized)
}

function hasBypass(transcriptPath: string | undefined): boolean {
  return (
    !!transcriptPath && bypassPhrasePresent(transcriptPath, BYPASS_PHRASES)
  )
}

function blockBash(vars: string[], transcriptPath: string | undefined): void {
  if (hasBypass(transcriptPath)) {
    return
  }
  logger.error(
    [
      '[npmrc-trust-optout-guard] Blocked: pnpm trust-aware expansion opt-out',
      '',
      `  Env var(s):  ${vars.join(', ')}`,
      '',
      '  Setting these DISABLES the protection pnpm 10.34.2 / 11.5.3 added: it',
      '  stops `${ENV}` expansion in repo-controlled `.npmrc` credential lines',
      '  so a malicious repo cannot exfiltrate a token at install. Re-enabling',
      '  expansion for the checkout re-opens that hole.',
      '',
      '  Fix: keep auth out of repo `.npmrc` (use the OS keychain / CI secrets',
      '  via a HOME-level `~/.npmrc`); do not point pnpm/npm config at a',
      '  repo-local `.npmrc`.',
      '',
      `  Bypass (CI image building only trusted first-party repos): type`,
      `  "${BYPASS_PHRASES[0]}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
}

function checkBash(command: string, transcriptPath: string | undefined): void {
  const found = detectOptoutInCommands(parseCommands(command))
  if (found.size === 0) {
    return
  }
  blockBash([...found].toSorted(), transcriptPath)
}

function checkEdit(
  filePath: string,
  afterText: string,
  transcriptPath: string | undefined,
): void {
  if (!afterText) {
    return
  }
  const reasons: string[] = []
  if (isCommittedConfigFile(filePath)) {
    for (const { line, name } of detectOptoutInFileText(afterText)) {
      reasons.push(`${name} set at line ${line}`)
    }
  }
  if (path.basename(filePath) === '.npmrc') {
    for (const line of detectAuthEnvPlaceholderInNpmrc(afterText)) {
      reasons.push(
        `\`\${ENV}\` placeholder beside an auth/registry key at line ${line}`,
      )
    }
  }
  if (reasons.length === 0 || hasBypass(transcriptPath)) {
    return
  }
  logger.error(
    [
      '[npmrc-trust-optout-guard] Blocked: committed trust-expansion opt-out',
      '',
      `  File:    ${filePath}`,
      ...reasons.map(r => `  Found:   ${r}`),
      '',
      '  A committed `${ENV}` beside `_authToken`/`registry` is the exact',
      '  credential-exfiltration shape pnpm 10.34.2 / 11.5.3 now refuses to',
      '  expand; landing one of the trust-opt-out env vars into a tracked',
      '  config/script/workflow re-enables expansion and re-opens the hole.',
      '',
      '  Fix: keep auth in the OS keychain (dev) or CI secrets, referenced from',
      '  a HOME-level `~/.npmrc` — never a repo-committed `.npmrc`; drop the',
      '  opt-out env var from the committed file.',
      '',
      `  Bypass (CI image building only trusted first-party repos): type`,
      `  "${BYPASS_PHRASES[0]}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
}

// Single stdin drain, then dispatch on tool_name — two sequential
// `with*Guard` harnesses would each try to read stdin and the second would
// get nothing. Fail open on any throw.
export async function main(): Promise<void> {
  try {
    const payload = await readPayload()
    if (!payload) {
      return
    }
    const tool = payload.tool_name
    const transcriptPath = payload.transcript_path
    if (tool === 'Bash') {
      const command = readCommand(payload)
      if (command && command.trim()) {
        checkBash(command, transcriptPath)
      }
      return
    }
    if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
      const filePath = readFilePath(payload)
      const afterText = readWriteContent(payload)
      if (filePath && afterText !== undefined) {
        checkEdit(filePath, afterText, transcriptPath)
      }
    }
  } catch {
    // Fail open: a guard error must not block the user's action.
    process.exitCode = 0
  }
}

await main()
