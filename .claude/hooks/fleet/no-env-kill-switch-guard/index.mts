#!/usr/bin/env node
// Claude Code PreToolUse hook — no-env-kill-switch-guard.
//
// Blocks Edit/Write tool calls that add an environment-variable kill switch to
// a fleet hook's index.mts. Hooks are guardrails for AI-generated code; a
// per-hook `SOCKET_*_DISABLED` env var lets a session silently neuter a hook,
// which defeats the point. The ONLY sanctioned way to skip a hook is the
// `Allow <X> bypass` phrase (user-typed, transcript-scoped, auditable).
//
// Banned shapes (recognized at edit time in a `.claude/hooks/**/index.mts`):
//   disabledEnvVar: 'SOCKET_FOO_DISABLED'        (runStopReminder config field)
//   process.env['SOCKET_FOO_DISABLED']           (direct read)
//   process.env.SOCKET_FOO_DISABLED              (direct read, dot form)
//   isHookDisabled('foo')                         (any disable-by-env helper)
//
// Allowed (passes through):
//   - the SOCKET_PRE_{COMMIT,PUSH}_ALLOW_UNSIGNED escape used by the signing
//     setup (a documented break-glass, not a hook kill switch), and the
//     wheelhouse-cascade FLEET_SYNC marker — neither matches the *_DISABLED
//     shape.
//   - non-hook files (only `.claude/hooks/**/index.mts` is policed).
//   - this guard's own test fixtures.
//   - Bypass phrase `Allow env-kill-switch bypass` typed verbatim.
//
// Exit codes: 0 — pass; 2 — block. Fails open on malformed payloads.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow env-kill-switch bypass'

interface Finding {
  readonly line: number
  readonly text: string
}

// Each regex flags a per-hook env kill switch. The `_DISABLED` suffix on a
// SOCKET_-prefixed name is the fleet convention for these; `disabledEnvVar` is
// the runStopReminder config key.
const BANNED_PATTERNS: readonly RegExp[] = [
  /\bdisabledEnvVar\b/,
  /process\.env\[\s*['"`][A-Z_]*_DISABLED['"`]\s*\]/,
  /process\.env\.[A-Za-z_][A-Za-z0-9_]*_DISABLED\b/,
  /\bisHookDisabled\s*\(/,
]

export function findKillSwitches(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    for (let pi = 0, { length: pLen } = BANNED_PATTERNS; pi < pLen; pi += 1) {
      if (BANNED_PATTERNS[pi]!.test(line)) {
        findings.push({ line: i + 1, text: line.trimEnd() })
        break
      }
    }
  }
  return findings
}

export function isHookIndexPath(filePath: string): boolean {
  return (
    /\/\.claude\/hooks\/(?:fleet|repo)\/[^/]+\/index\.mts$/.test(filePath) &&
    !filePath.includes('/node_modules/')
  )
}

export function isOwnTestPath(filePath: string): boolean {
  return filePath.includes('/.claude/hooks/fleet/no-env-kill-switch-guard/')
}

await withEditGuard((filePath, content, payload) => {
  if (!isHookIndexPath(filePath) || isOwnTestPath(filePath)) {
    return
  }
  const text = content ?? ''
  if (!text) {
    return
  }
  const findings = findKillSwitches(text)
  if (findings.length === 0) {
    return
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    logger.error(
      `no-env-kill-switch-guard: ${findings.length} env kill switch(es) — bypassed via "${BYPASS_PHRASE}"\n`,
    )
    return
  }
  const detail = findings
    .map(f => `  ${filePath}:${f.line}\n    ${f.text}`)
    .join('\n')
  logger.error(
    `no-env-kill-switch-guard: refusing to add an env-var kill switch to a hook.\n` +
      `\n` +
      `${detail}\n` +
      `\n` +
      `Hooks carry no env kill switch — the only sanctioned disable is the\n` +
      `\`Allow <X> bypass\` phrase (user-typed, transcript-scoped, auditable).\n` +
      `Remove the disabledEnvVar / SOCKET_*_DISABLED check.\n` +
      `\n` +
      `Bypass: type "${BYPASS_PHRASE}" in a recent message.\n`,
  )
  process.exitCode = 2
})
