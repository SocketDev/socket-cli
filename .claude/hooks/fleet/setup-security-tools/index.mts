#!/usr/bin/env node
// Claude Code Stop hook — setup-security-tools health-check.
//
// Read-only diagnostic that fires at turn-end and surfaces problems
// with the Socket security tools (AgentShield, Zizmor, SFW). Never
// auto-downloads — the heavy lifting (network calls, keychain prompts,
// shim rewrites) lives in `install.mts` and is operator-invoked.
//
// What it checks:
//
//   1. SFW shim integrity. Walks `~/.socket/_wheelhouse/shims/*` and reports
//      shims whose dlx-cached binary target no longer exists on disk.
//      Cache eviction, manifest rebuild, manual cleanup, leaves
//      shims pointing at vanished hashes — every `pnpm` / `npm` /
//      etc. call then fails with "No such file or directory" until
//      the shims are rewritten.
//
//   2. Token / SFW edition consistency. If a SOCKET_API_TOKEN is
//      available (env or OS keychain) but the SFW shim is the free
//      build, the operator is paying for enterprise scanning they
//      aren't getting. The reverse — no token but enterprise shim —
//      is rarer but equally inconsistent.
//
//   3. Stale / expired token detection. Reads the last assistant turn
//      from the Stop payload's transcript_path and looks for the
//      Socket API "SOCKET_API_KEY validation got status of 401" error
//      surfaced by sfw / agentshield / the SDK. When it fires, the
//      remediation is `install.mts --rotate` (overwrites the keychain
//      entry with a fresh token), not the plain `install.mts` invocation.
//
// Output: stderr lines starting with `[setup-security-tools]`. Each
// finding ends with the exact remediation command:
//
//   node .claude/hooks/fleet/setup-security-tools/install.mts
//
//
// Fails open on every error (exit 0 + stderr log). The hook must
// not block the conversation on its own bugs.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getSocketAppDir } from '@socketsecurity/lib-stable/paths/socket'

import {
  CORE_SHIM_COMMANDS,
  findBrokenShimTargets,
  getShimsDir,
  missingCoreShims,
} from './lib/shims.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

interface Finding {
  readonly kind:
    | 'broken-shim'
    | 'edition-mismatch'
    | 'auto-repaired'
    | 'token-401'
  readonly message: string
}

/**
 * Regex for the Socket API 401-validation error message. The exact text is
 * emitted by every Socket-tool client (sfw, agentshield, socket-cli, the JS
 * SDK) when the configured token is rejected at upstream. We match a loose
 * shape so a future variant of the sentence (newline-wrapped, prefixed with
 * file-path, etc.) still trips the rule.
 *
 * Why: the SDK + sfw render this same error to stderr / stdout, but the
 * operator usually scrolls past it and the next tool call also 401s. The right
 * remediation is to rotate the token, not to retry.
 *
 * Recognized today:
 *
 * - "SOCKET_API_KEY validation got status of 401 from the Socket API"
 * - "SOCKET_API_TOKEN validation got status of 401 from the Socket API"
 *   (forward-looking, in case the fleet env-var rename reaches the upstream SDK
 *   error path)
 */
const TOKEN_401_RE =
  /SOCKET_API_(?:KEY|TOKEN) validation got status of 401 from the Socket API/

export function checkEdition(): Finding[] {
  const shimPath = path.join(getSocketAppDir('wheelhouse'), 'shims', 'pnpm')
  if (!existsSync(shimPath)) {
    return []
  }
  let content = ''
  try {
    content = readFileSync(shimPath, 'utf8')
  } catch {
    return []
  }
  const isFree = content.includes('sfw-free')
  const isEnt = content.includes('sfw-enterprise')
  // Setup tooling detects whether a token is present in the raw env; the
  // keychain-fallback getter would defeat that "is it wired up yet?" check.
  // Only the canonical SOCKET_API_TOKEN counts — legacy aliases
  // (SOCKET_API_KEY et al.) are retired per socket-api-token-env.
  // socket-api-token-getter: allow direct-env
  const tokenPresent = !!process.env['SOCKET_API_TOKEN']
  if (isFree && tokenPresent) {
    return [
      {
        kind: 'edition-mismatch',
        message:
          'SOCKET_API_TOKEN is set but the SFW shim is the free build — run ' +
          '`node .claude/hooks/fleet/setup-security-tools/install.mts` to ' +
          'switch to sfw-enterprise',
      },
    ]
  }
  // No findings for the enterprise-without-token shape — having an
  // enterprise shim provisioned ahead of token setup is common during
  // onboarding and the operator will fix it when their key arrives.
  // Listing it as a "finding" would just create noise.
  void isEnt
  return []
}

export async function checkShims(): Promise<Finding[]> {
  const shimsDir = getShimsDir()
  if (!existsSync(shimsDir)) {
    return []
  }
  let entries: string[]
  try {
    entries = await fs.readdir(shimsDir)
  } catch {
    return []
  }
  const broken: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    const shimPath = path.join(shimsDir, name)
    let content: string
    try {
      content = await fs.readFile(shimPath, 'utf8')
    } catch {
      continue
    }
    // Only bash shim files carry exec targets; binaries/symlinks in the same
    // bin dir, flat racked-tool handles, have no quoted paths and skip clean.
    if (!content.startsWith('#!')) {
      continue
    }
    if (findBrokenShimTargets(content).length > 0) {
      broken.push(name)
    }
  }
  if (broken.length === 0) {
    return []
  }
  return [
    {
      kind: 'broken-shim',
      message:
        `SFW shim${broken.length === 1 ? '' : 's'} point${broken.length === 1 ? 's' : ''} ` +
        `at a missing target "${broken.join(', ')}" (every command through ` +
        `${broken.length === 1 ? 'that shim' : 'those shims'} fails ENOENT) — run ` +
        `\`node scripts/fleet/setup/tools.mjs\` (or interactive install.mts) to rewrite`,
    },
  ]
}

/**
 * Scan the most recent assistant turn for the Socket API 401- validation error.
 * The transcript path comes from the Stop payload piped to the hook; if it's
 * missing or unreadable we return no findings — never throw, never block.
 *
 * Reads the whole JSONL one line at a time (the transcript is usually < 1 MB
 * but can grow); we walk in reverse so we stop at the last assistant turn
 * instead of dragging through old context.
 */
export async function checkToken401(
  transcriptPath: string,
): Promise<Finding[]> {
  if (!existsSync(transcriptPath)) {
    return []
  }
  let raw: string
  try {
    raw = await fs.readFile(transcriptPath, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n')
  // Walk backwards — only the most recent assistant turn matters.
  // Stop at the *second* assistant boundary so prior 401s don't
  // re-trigger after a successful rotation.
  let assistantTurnsSeen = 0
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (!line) {
      continue
    }
    let entry: {
      type?: string | undefined
      message?: { content?: unknown | undefined } | undefined
    }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'assistant') {
      continue
    }
    assistantTurnsSeen += 1
    if (assistantTurnsSeen > 1) {
      break
    }
    // The `message.content` field is an array of blocks; the text
    // blocks have `{ type: 'text', text: '...' }`. Tool-use blocks
    // carry the actual error string in their `text` rendering, so
    // stringify the whole content and grep — cheaper than walking
    // the schema and catches every shape upstream might use.
    const haystack = JSON.stringify(entry.message?.content ?? '')
    if (TOKEN_401_RE.test(haystack)) {
      return [
        {
          kind: 'token-401',
          message:
            'Socket API returned 401 (token invalid/expired) — run ' +
            '`node .claude/hooks/fleet/setup-security-tools/install.mts ' +
            '--rotate` to overwrite the keychain entry',
        },
      ]
    }
  }
  return []
}

/**
 * Silently auto-repair an empty/missing SFW shims directory when the SFW binary
 * + the regenerate script are both present. This handles the common failure
 * shape where shims got renamed/moved (`shims.broken-backup/`) and the operator
 * forgot to re-run the regenerator. Returns a single 'auto-repaired' finding on
 * success, so the user sees one tidy notice instead of nothing — or nothing if
 * the repair conditions weren't met / the script failed.
 */
export function repairShims(home: string): Finding[] {
  // Use the lib-stable helper for cross-platform consistency and to
  // honor the canonical "_wheelhouse" umbrella. The home arg is
  // accepted for backwards-compat with the existing call site but
  // ignored in favor of the lib-stable resolution.
  void home
  const sfwDir = getSocketAppDir('wheelhouse')
  const shimsDir = getShimsDir()
  const sfwBin = path.join(sfwDir, 'bin', 'sfw')
  // The fleet shim generator is the repo's dep-0 bootstrap (cascaded into
  // every member), not a per-machine bash script — regeneration IS that
  // script (code-first: one generator owns the shims).
  const generator = path.join(
    resolveProjectDir(),
    'scripts',
    'fleet',
    'setup',
    'tools.mjs',
  )

  // Both the sfw binary and the generator must exist. If either is
  // missing the repair can't run; the diagnostic path will surface
  // the install command instead.
  if (!existsSync(sfwBin) || !existsSync(generator)) {
    return []
  }

  // Repair triggers when the shim dir is missing OR every core shim is
  // absent (the "shims were wiped / never generated" shape). A partially
  // populated dir is handled by checkShims() per-shim broken reporting —
  // the bin dir also holds flat racked-tool handles, so plain emptiness is
  // not a usable signal.
  const wiped =
    !existsSync(shimsDir) ||
    missingCoreShims(shimsDir).length >= CORE_SHIM_COMMANDS.length
  if (!wiped) {
    return []
  }

  const r = spawnSync('node', [generator], {})
  if (r.status !== 0) {
    // Failed — fall through to checkShims() which will report the
    // missing/broken state and the install command. Don't double-
    // report here.
    return []
  }

  return [
    {
      kind: 'auto-repaired',
      message:
        'SFW shims were missing/wiped — auto-repaired via ' +
        /* c8 ignore start - split always yields ≥1 element so pop() never returns undefined */
        `${generator}. ${String(r.stdout).trim().split('\n').pop() ?? ''}`.trim(),
      /* c8 ignore stop */
    },
  ]
}

export const hook = defineHook({
  /* c8 ignore start - check() runs real machine-state probes (shim dir, keychain,
     transcript scan); covered by integration tests that spawn a subprocess */
  check: async payload => {
    const findings: Finding[] = []

    // Auto-repair pass first. If shims/ is empty AND we have the binary
    // + regen script, rebuild silently — this covers the common "moved
    // to .broken-backup/" failure shape. After repair, checkShims()
    // sees a populated shims/ dir and stays quiet, so the operator
    // gets one notice line instead of a wall of diagnostics.
    const home = process.env['HOME']
    if (home) {
      findings.push(...repairShims(home))
    }

    findings.push(...(await checkShims()))
    findings.push(...checkEdition())
    // The Stop payload carries transcript_path; scan the most recent
    // assistant turn for the 401 error signature when present.
    const transcriptPath = payload.transcript_path
    if (transcriptPath) {
      findings.push(...(await checkToken401(transcriptPath)))
    }

    if (findings.length === 0) {
      return undefined
    }
    const lines: string[] = []
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const prefix = i === 0 ? 'ℹ setup-security-tools: ' : '   '
      lines.push(`${prefix}${findings[i]!.message}`)
    }
    return notify(lines.join('\n'))
  },
  /* c8 ignore stop */
  event: 'Stop',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
