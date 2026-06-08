#!/usr/bin/env node
// Claude Code PreToolUse(Bash) hook — package-manager-auto-update-guard.
//
// Blocks a package-manager invocation (`brew` / `choco` / `winget` / `scoop` /
// `npm` / `pnpm`) when that manager's auto-update is still ENABLED on this
// machine. An auto-updating manager can change a tool's version underneath a
// build / scan, add latency, or pull an unsoaked package — a reproducibility +
// supply-chain hazard (CLAUDE.md Tooling). The fix is to disable auto-update
// (run setup-security-tools, which sets the knob).
//
// All detection logic lives in _shared/package-manager-auto-update.mts — the
// SAME module the audit-package-manager-auto-update.mts script and
// setup-security-tools consume, so the three never drift (code is law, DRY).
//
// AST-parses the command via shell-command.mts/findInvocation (per the
// no-command-regex-in-hooks rule) — never a raw regex on the command string.
//
// Bypass: the blanket `Allow package-manager-auto-update bypass`, OR a
// per-manager `Allow <name> auto-update bypass` (e.g. `Allow brew auto-update
// bypass`) to green one manager without disabling the guard for the rest.
//
// Exit codes: 0 — pass; 2 — block. Fails open on any throw.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  bypassPhrasesFor,
  matchInvokedManager,
} from '../_shared/package-manager-auto-update.mts'
import { withBashGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

void (async () => {
  await withBashGuard((command, payload) => {
    const check = matchInvokedManager(command)
    if (!check) {
      return
    }
    const status = check.detect()
    // Only block when auto-update is actively ENABLED. 'absent' (manager not
    // installed) and 'disabled' (already hardened) both pass.
    if (status.state !== 'enabled') {
      return
    }
    if (bypassPhrasePresent(payload.transcript_path, bypassPhrasesFor(check))) {
      return
    }
    logger.error(
      [
        `[package-manager-auto-update-guard] Blocked: \`${check.binaries[0]}\` while ${check.id} auto-update is enabled.`,
        '',
        `  ${status.reason}.`,
        '  An auto-updating package manager can change a tool version',
        '  mid-task or pull an unsoaked package (CLAUDE.md Tooling).',
        '',
        '  Fix (disable auto-update):',
        `    ${status.fix}`,
        '  Or run the fleet installer that sets every knob:',
        '    node .claude/hooks/fleet/setup-security-tools/install.mts',
        '',
        '  Bypass (this manager only):',
        `    Allow ${check.binaries[0]} auto-update bypass`,
        '  Bypass (all managers):',
        '    Allow package-manager-auto-update bypass',
        '',
      ].join('\n'),
    )
    process.exitCode = 2
  })
})()
