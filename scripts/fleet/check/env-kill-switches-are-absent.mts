// Fleet check — no env kill-switches anywhere in the hook tree.
//
// The fleet rule (CLAUDE.md "Hook bypasses require the canonical phrase"): the
// ONLY way to disable a hook is the user typing "Allow <X> bypass". A per-hook
// SOCKET_*_DISABLED env var (or a `disabledEnvVar` config field, or an
// `isHookDisabled()` call) lets a session silently neuter a guard — exactly the
// blast radius the bypass-phrase rule exists to prevent.
//
// The edit-time `no-env-kill-switch-guard` hook blocks NEW writes that
// introduce one, but it never swept the back-catalog: a fleet-wide audit
// (2026-06-06) found 14 hooks still READING process.env[...DISABLED] plus ~80
// files MENTIONING a dead SOCKET_*_DISABLED in comments / stderr messages /
// READMEs / tests. This commit-time gate is the full-scan complement — it fails
// `check --all` if ANY hook file (index.mts, README.md, or test) names a
// SOCKET_*_DISABLED env var or uses the functional disabledEnvVar /
// isHookDisabled forms.
//
// STRICT by design: it matches the env-var TOKEN, not just a functional read,
// because a comment or stderr message advertising a "Disable: SOCKET_X=1"
// escape that no longer works is itself misleading — there is one canonical
// disable, and it is the phrase.
//
// Self-exempt: the `no-env-kill-switch-guard` hook itself (its source + README +
// tests legitimately name the patterns it bans) and this check's own test.
//
// Usage: node scripts/fleet/check/env-kill-switches-are-absent.mts [--quiet]

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Hooks whose files legitimately NAME the banned patterns: the edit-time guard
// that bans them, and this check's own test fixtures.
const SELF_EXEMPT_HOOKS = new Set(['no-env-kill-switch-guard'])

// Patterns that constitute an env kill-switch. The first three are functional
// (a read / config field / helper call that actually neuters the hook); the
// last is the bare token, caught so stale comments + messages + docs that
// advertise a dead escape are flagged too (strict mode).
const BANNED_PATTERNS: readonly RegExp[] = [
  /\bdisabledEnvVar\b/,
  /\bisHookDisabled\s*\(/,
  /process\.env\[\s*['"`][A-Z_]*_DISABLED['"`]\s*\]/,
  /\bSOCKET_[A-Z0-9_]*_DISABLED\b/,
]

export interface KillSwitchHit {
  readonly file: string
  readonly line: number
  readonly text: string
}

// Scan one file's text for any banned pattern; returns one hit per matching
// line (first matching pattern wins, so a line isn't double-counted).
export function scanText(relFile: string, text: string): KillSwitchHit[] {
  const hits: KillSwitchHit[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    for (let pi = 0, { length: pLen } = BANNED_PATTERNS; pi < pLen; pi += 1) {
      if (BANNED_PATTERNS[pi]!.test(line)) {
        hits.push({ file: relFile, line: i + 1, text: line.trim() })
        break
      }
    }
  }
  return hits
}

// Files worth scanning inside a hook dir: the index, README, and any test.
function isScannableHookFile(filePath: string): boolean {
  const base = path.basename(filePath)
  return (
    base === 'index.mts' ||
    base === 'README.md' ||
    base.endsWith('.test.mts')
  )
}

// Recursively collect scannable files under a hooks dir, skipping the
// self-exempt hook directories and node_modules.
export function collectHookFiles(hooksDir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(hooksDir)
  } catch {
    return out
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!;
    if (name === 'node_modules' || name.startsWith('.')) {
      continue
    }
    if (SELF_EXEMPT_HOOKS.has(name)) {
      continue
    }
    const abs = path.join(hooksDir, name)
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      out.push(...collectHookFiles(abs))
    } else if (isScannableHookFile(abs)) {
      out.push(abs)
    }
  
  }
  return out
}

export function scanHooks(repoRoot: string): KillSwitchHit[] {
  const hits: KillSwitchHit[] = []
  for (const seg of ['fleet', 'repo']) {
    const hooksDir = path.join(repoRoot, '.claude', 'hooks', seg)
    for (const abs of collectHookFiles(hooksDir)) {
      let text: string
      try {
        text = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      const rel = path.relative(repoRoot, abs)
      hits.push(...scanText(rel, text))
    }
  }
  return hits
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const hits = scanHooks(REPO_ROOT)
  if (hits.length) {
    logger.fail(
      '[check-env-kill-switches-are-absent] env kill-switch references in the hook tree:',
    )
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const h = hits[i]!
      logger.error(`  ✗ ${h.file}:${h.line} — ${h.text}`)
    }
    logger.error(
      '  The only hook disable is the canonical "Allow <X> bypass" phrase. Remove the SOCKET_*_DISABLED / disabledEnvVar / isHookDisabled reference (code, comment, message, README, or test).',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-env-kill-switches-are-absent] no env kill-switches in the hook tree.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
