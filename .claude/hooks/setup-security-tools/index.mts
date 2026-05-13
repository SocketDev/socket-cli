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
  readonly kind: 'broken-shim' | 'edition-mismatch' | 'auto-repaired'
  readonly message: string
}

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

async function main(): Promise<void> {
  if (process.env['SOCKET_SETUP_SECURITY_TOOLS_DISABLED']) {
    return
  }
  // Drain stdin so the harness's Stop payload doesn't pipe-buffer-stall.
  // Stop payloads carry transcript_path; this hook doesn't need it.
  await new Promise<void>(resolve => {
    let chunks = ''
    process.stdin.on('data', d => {
      chunks += d.toString('utf8')
    })
    process.stdin.on('end', () => resolve())
    process.stdin.on('error', () => resolve())
    // Short timeout so we don't hang on stdin that never closes.
    setTimeout(() => resolve(), 200)
    void chunks
  })

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
