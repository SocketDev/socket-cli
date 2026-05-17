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
//   1. SFW shim integrity. Walks `~/.socket/sfw/shims/*` and reports
//      shims whose dlx-cached binary target no longer exists on disk.
//      Cache eviction (manifest rebuild, manual cleanup) leaves
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
//   node .claude/hooks/setup-security-tools/install.mts
//
// Disabled via `SOCKET_SETUP_SECURITY_TOOLS_DISABLED=1`.
//
// Fails open on every error (exit 0 + stderr log). The hook must
// not block the conversation on its own bugs.

import { spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

interface Finding {
  readonly kind:
    | 'broken-shim'
    | 'edition-mismatch'
    | 'auto-repaired'
    | 'token-401'
  readonly message: string
}

/**
 * Regex for the Socket API 401-validation error message. The exact
 * text is emitted by every Socket-tool client (sfw, agentshield,
 * socket-cli, the JS SDK) when the configured token is rejected at
 * upstream. We match a loose shape so a future variant of the
 * sentence (newline-wrapped, prefixed with file-path, etc.) still
 * trips the rule.
 *
 * Why: the SDK + sfw render this same error to stderr / stdout, but
 * the operator usually scrolls past it and the next tool call also
 * 401s. The right remediation is to rotate the token, not to retry.
 *
 * Recognized today:
 *   - "SOCKET_API_KEY validation got status of 401 from the Socket API"
 *   - "SOCKET_API_TOKEN validation got status of 401 from the Socket API"
 *     (forward-looking, in case the fleet env-var rename reaches the
 *      upstream SDK error path)
 */
const TOKEN_401_RE =
  /SOCKET_API_(?:KEY|TOKEN) validation got status of 401 from the Socket API/

/**
 * Silently auto-repair an empty/missing SFW shims directory when the
 * SFW binary + the regenerate script are both present. This handles
 * the common failure shape where shims got renamed/moved
 * (`shims.broken-backup/`) and the operator forgot to re-run the
 * regenerator. Returns a single 'auto-repaired' finding on success
 * (so the user sees one tidy notice instead of nothing) — or nothing
 * if the repair conditions weren't met / the script failed.
 */
function repairShims(home: string): Finding[] {
  const sfwDir = path.join(home, '.socket', 'sfw')
  const shimsDir = path.join(sfwDir, 'shims')
  const sfwBin = path.join(sfwDir, 'bin', 'sfw')
  const regen = path.join(sfwDir, 'regenerate-shims.sh')

  // Both the binary and the regen script must exist. If either is
  // missing the repair can't run; the diagnostic path will surface
  // the install command instead.
  if (!existsSync(sfwBin) || !existsSync(regen)) {
    return []
  }

  // Repair triggers when shims/ is missing OR empty. A populated
  // shims/ dir is handled by checkShims() (which reports broken
  // individual shims).
  let isEmpty = true
  if (existsSync(shimsDir)) {
    try {
      const entries = require('node:fs').readdirSync(shimsDir) as string[]
      isEmpty = entries.length === 0
    } catch {
      // Unreadable dir — treat as broken; let regen recreate it.
      isEmpty = true
    }
  }
  if (!isEmpty) {
    return []
  }

  const r = spawnSync('bash', [regen], { encoding: 'utf8' })
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
        'SFW shims were missing/empty — auto-repaired via ' +
        `${regen}. ${r.stdout.trim().split('\n').pop() ?? ''}`.trim(),
    },
  ]
}

async function checkShims(): Promise<Finding[]> {
  const home = process.env['HOME']
  if (!home) {
    return []
  }
  const shimsDir = path.join(home, '.socket', 'sfw', 'shims')
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
  for (const name of entries) {
    const shimPath = path.join(shimsDir, name)
    let content: string
    try {
      content = await fs.readFile(shimPath, 'utf8')
    } catch {
      continue
    }
    const m = content.match(/"([^"]*\/_dlx\/[^"]+\/sfw-(?:free|enterprise))"/)
    if (!m) {
      continue
    }
    if (!existsSync(m[1]!)) {
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
        `SFW shim${broken.length === 1 ? '' : 's'} point to a missing dlx ` +
        `target: ${broken.join(', ')}. The dlx cache evicted the binary ` +
        `(manifest rebuild, manual delete, or cache rotation). Every ` +
        `command through ${broken.length === 1 ? 'that shim' : 'those shims'} ` +
        `currently fails with "No such file or directory." Run ` +
        `\`node .claude/hooks/setup-security-tools/install.mts\` to ` +
        `re-download SFW and rewrite the shims.`,
    },
  ]
}

function checkEdition(): Finding[] {
  const home = process.env['HOME']
  if (!home) {
    return []
  }
  const shimPath = path.join(home, '.socket', 'sfw', 'shims', 'pnpm')
  if (!existsSync(shimPath)) {
    return []
  }
  let content = ''
  try {
    content = require('node:fs').readFileSync(shimPath, 'utf8') as string
  } catch {
    return []
  }
  const isFree = content.includes('sfw-free')
  const isEnt = content.includes('sfw-enterprise')
  const tokenPresent =
    !!process.env['SOCKET_API_TOKEN'] || !!process.env['SOCKET_API_KEY']
  if (isFree && tokenPresent) {
    return [
      {
        kind: 'edition-mismatch',
        message:
          'SOCKET_API_TOKEN is set but the SFW shim is the free build. ' +
          'Run `node .claude/hooks/setup-security-tools/install.mts` to ' +
          'switch to sfw-enterprise (org-aware malware scanning + private ' +
          'package data).',
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

/**
 * Scan the most recent assistant turn for the Socket API 401-
 * validation error. The transcript path comes from the Stop payload
 * piped to the hook; if it's missing or unreadable we return no
 * findings — never throw, never block.
 *
 * Reads the whole JSONL one line at a time (the transcript is
 * usually < 1 MB but can grow); we walk in reverse so we stop at the
 * last assistant turn instead of dragging through old context.
 */
async function checkToken401(transcriptPath: string): Promise<Finding[]> {
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
    let entry: { type?: string; message?: { content?: unknown } }
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
            'Socket API returned 401 — the configured SOCKET_API_TOKEN ' +
            'is invalid, expired, or lacks the required permissions. ' +
            'Run `node .claude/hooks/setup-security-tools/install.mts ' +
            '--rotate` to re-prompt and overwrite the keychain entry.',
        },
      ]
    }
  }
  return []
}

async function main(): Promise<void> {
  if (process.env['SOCKET_SETUP_SECURITY_TOOLS_DISABLED']) {
    return
  }
  // Read the Stop payload from stdin. We use `transcript_path` to
  // scan the most recent assistant turn for the 401 error signature.
  // Drain even if we can't parse so the pipe doesn't buffer-stall.
  let payloadRaw = ''
  await new Promise<void>(resolve => {
    process.stdin.on('data', d => {
      payloadRaw += d.toString('utf8')
    })
    process.stdin.on('end', () => resolve())
    process.stdin.on('error', () => resolve())
    // Short timeout so we don't hang on stdin that never closes.
    setTimeout(() => resolve(), 200)
  })
  let transcriptPath: string | undefined
  if (payloadRaw) {
    try {
      const payload = JSON.parse(payloadRaw) as { transcript_path?: string }
      if (typeof payload.transcript_path === 'string') {
        transcriptPath = payload.transcript_path
      }
    } catch {
      // Malformed payload — skip the 401 scan but still run the
      // shim/edition checks.
    }
  }

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
  if (transcriptPath) {
    findings.push(...(await checkToken401(transcriptPath)))
  }

  if (findings.length === 0) {
    return
  }
  process.stderr.write('[setup-security-tools] Health check:\n')
  for (const f of findings) {
    process.stderr.write(`  • ${f.message}\n`)
  }
}

main().catch(e => {
  process.stderr.write(
    `[setup-security-tools] health-check error (allowing): ${e}\n`,
  )
})
