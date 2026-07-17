#!/usr/bin/env node
/*
 * @file Fleet check — source stays windows-portable.
 *
 *   Every class here shipped a real windows-only CI failure, each failing
 *   OPEN (a skipped gate, a silent allow, a "rotating flake") rather than
 *   loud — full catalog + canonical fixes: docs/agents.md/fleet/windows-gotchas.md.
 *
 *   ERROR when a scanned source file contains:
 *     1. A pnpm/npm/npx/yarn spawn with no `shell:` option in the same call —
 *        `.cmd` shims cannot execute unshelled on windows (the
 *        version-bump-order gate silently vanished on every windows run).
 *     2. `new URL(…).pathname` — yields `/D:/…` on windows; any resolve
 *        doubles the drive. Use `fileURLToPath(new URL(…))`.
 *     3. `process.platform === 'win32'` (either operand order) — use the
 *        canonical `WIN32` from `@socketsecurity/lib-stable/constants/platform`.
 *     4. A short raw `timeout: <ms>` (≤ 15000) on a `spawn`/`spawnSync` for a
 *        LOCAL process — win32 process creation (a `.cmd`/`.bat` shim via
 *        cmd.exe, no cheap fork) spikes under CI load and blows a POSIX-fine
 *        timeout, killing a slow-but-alive probe → empty output → a guard
 *        fails OPEN. Wrap it in `spawnTimeoutMs(<ms>)` (_shared/spawn-timeout).
 *        A NETWORK spawn (`gh api`, `gh pr list`) keeps its raw bounded timeout
 *        and opts out with a `// win-timeout: network` note inside the call.
 *
 *   Scans template/base/{scripts,.claude/hooks,.config,.git-hooks} + the
 *   wheelhouse-owned scripts/repo — the fleet-shipped executable surface.
 *   String/comment content is stripped before matching (scanners parse at
 *   command position, never substring over prose).
 *
 *   Usage: node scripts/fleet/check/source-is-windows-portable.mts [--quiet]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const SCAN_ROOTS = [
  'template/base/scripts',
  'template/base/.claude/hooks',
  'template/base/.config',
  'template/base/.git-hooks',
  'scripts/repo',
]

const SKIP_SEGMENTS = new Set([
  '_dispatch',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

export interface PortabilityHit {
  readonly file: string
  readonly line: number
  readonly rule:
    | 'cmd-shim'
    | 'url-pathname'
    | 'platform-literal'
    | 'spawn-timeout'
  readonly snippet: string
}

// Strip line/block comments and string/template literals so prose (docs in
// comments, fixture strings, this check's own messages) can't be harvested as
// findings. Replaces each with same-length spaces to keep line numbers.
export function stripInertText(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]!
    const next = src[i + 1]
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' '
        i += 1
      }
      continue
    }
    if (ch === '/' && next === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += '  '
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out += ch
      i += 1
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        out += src[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += src[i] ?? ''
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return out
}

// A pnpm/npm/npx/yarn spawn call whose OPTIONS (to the matching close paren of
// the call) carry no `shell:` key. The binary name sits in a string literal,
// so match against the RAW source at positions the STRIPPED source proves are
// call sites.
export function scanCmdShimSpawns(raw: string): number[] {
  const stripped = stripInertText(raw)
  const lines: number[] = []
  // spawn/spawnSync call heads in executable code.
  const headRe = /\b(?:spawn|spawnSync)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = headRe.exec(stripped)) !== null) {
    const start = m.index
    // First argument in RAW source: a quoted bin name?
    const rawSlice = raw.slice(start, start + 160)
    if (
      !/^\s*(?:spawn|spawnSync)\s*\(\s*['"](?:pnpm|npm|np[x]|yarn)['"]/.test(
        rawSlice,
      )
    ) {
      continue
    }
    // Walk the stripped source to the call's closing paren; a `shell:` key
    // anywhere inside the call (options object) satisfies the rule.
    let depth = 0
    let end = start
    for (let i = start; i < stripped.length; i += 1) {
      const c = stripped[i]
      if (c === '(') {
        depth += 1
      } else if (c === ')') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const callBodyRaw = raw.slice(start, end + 1)
    if (!/\bshell\s*:/.test(callBodyRaw)) {
      lines.push(raw.slice(0, start).split('\n').length)
    }
  }
  return lines
}

export function scanUrlPathname(raw: string): number[] {
  const stripped = stripInertText(raw)
  const lines: number[] = []
  const re = /\)\s*\.pathname\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    // Only URL-shaped receivers: a `new URL(` within the preceding 200 chars
    // of the same statement.
    const before = stripped.slice(Math.max(0, m.index - 200), m.index)
    if (/\bnew\s+URL\s*\(/.test(before)) {
      lines.push(stripped.slice(0, m.index).split('\n').length)
    }
  }
  return lines
}

export function scanPlatformLiteral(raw: string): number[] {
  const lines: number[] = []
  const rawLines = raw.split('\n')
  for (let i = 0, { length } = rawLines; i < length; i += 1) {
    const stripped = stripInertText(rawLines[i]!)
    // The literal lives in a string, so test the RAW line but require the
    // comparison operator to survive stripping (i.e. executable code).
    if (
      /process\.platform\s*[!=]==?\s*['"]win32['"]|['"]win32['"]\s*[!=]==?\s*process\.platform/.test(
        rawLines[i]!,
      ) &&
      /process\.platform\s*[!=]==?|[!=]==?\s*process\.platform/.test(stripped)
    ) {
      lines.push(i + 1)
    }
  }
  return lines
}

// Below this ceiling a raw spawn timeout is a "probe" budget — short enough
// that win32 process-creation latency under CI load can blow it and kill a
// live process. Longer budgets (a `pnpm install`, a 30s codegen) aren't at
// risk of a spawn-latency kill, so they're left alone.
export const SHORT_SPAWN_TIMEOUT_CEILING_MS = 15_000

// A `spawn`/`spawnSync` call whose options carry a SHORT raw numeric
// `timeout: <ms>` (not `spawnTimeoutMs(...)`) and no `win-timeout:` opt-out.
// Detects the timeout literal in the STRIPPED body (executable code only, so a
// `timeout:` in a comment/string can't false-match) and the opt-out in the RAW
// body (the annotation IS a comment). Mirrors scanCmdShimSpawns' paren walk.
export function scanSpawnTimeouts(raw: string): number[] {
  const stripped = stripInertText(raw)
  const lines: number[] = []
  const headRe = /\b(?:spawn|spawnSync)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = headRe.exec(stripped)) !== null) {
    const start = m.index
    let depth = 0
    let end = start
    for (let i = start; i < stripped.length; i += 1) {
      const c = stripped[i]
      if (c === '(') {
        depth += 1
      } else if (c === ')') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const tm = /\btimeout\s*:\s*([0-9_]+)/.exec(stripped.slice(start, end + 1))
    if (!tm) {
      continue
    }
    if (/win-timeout:/.test(raw.slice(start, end + 1))) {
      continue
    }
    if (Number(tm[1]!.replace(/_/g, '')) > SHORT_SPAWN_TIMEOUT_CEILING_MS) {
      continue
    }
    lines.push(raw.slice(0, start + tm.index).split('\n').length)
  }
  return lines
}

export function scanFile(filePath: string): PortabilityHit[] {
  const raw = readFileSync(filePath, 'utf8')
  const rel = path.relative(REPO_ROOT, filePath)
  const hits: PortabilityHit[] = []
  for (const line of scanCmdShimSpawns(raw)) {
    hits.push({
      file: rel,
      line,
      rule: 'cmd-shim',
      snippet: 'pnpm/npm/npx/yarn spawn without a `shell:` option', // socket-lint: allow npx
    })
  }
  for (const line of scanUrlPathname(raw)) {
    hits.push({
      file: rel,
      line,
      rule: 'url-pathname',
      snippet: 'new URL(…).pathname used as a filesystem path',
    })
  }
  for (const line of scanPlatformLiteral(raw)) {
    hits.push({
      file: rel,
      line,
      rule: 'platform-literal',
      snippet: "process.platform compared to 'win32'",
    })
  }
  // spawn-timeout applies to HOOKS only: a PreToolUse guard whose probe is
  // killed by a too-tight win32 timeout fails OPEN *silently*. A script that
  // times out fails LOUD (non-zero exit), so it isn't the silent-hole this
  // rule guards — and scripts can't cleanly import the hook-tier _shared helper.
  if (rel.replace(/\\/g, '/').includes('.claude/hooks/')) {
    for (const line of scanSpawnTimeouts(raw)) {
      hits.push({
        file: rel,
        line,
        rule: 'spawn-timeout',
        snippet: 'short raw spawn timeout — wrap in spawnTimeoutMs()',
      })
    }
  }
  return hits
}

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name.startsWith('.') && name !== '.claude' && name !== '.config') {
      continue
    }
    if (SKIP_SEGMENTS.has(name)) {
      continue
    }
    const full = path.join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, out)
    } else if (/\.(?:mts|mjs|ts|js)$/.test(name) && !/\.d\.m?ts$/.test(name)) {
      out.push(full)
    }
  }
}

export function scanRepo(repoRoot: string): PortabilityHit[] {
  const files: string[] = []
  for (const root of SCAN_ROOTS) {
    walk(path.join(repoRoot, root), files)
  }
  const hits: PortabilityHit[] = []
  for (const f of files) {
    hits.push(...scanFile(f))
  }
  return hits
}

// Ratchet ceiling — the truthful backlog at introduction (2026-07-12). Only
// ever LOWER this number as sites are fixed; a count above it means NEW
// windows-portability debt and fails the gate. (Count-ratchet chosen over a
// per-site baseline for weight; the doc's classes make each fix mechanical.)
export const BASELINE_FINDINGS = 54

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const hits = scanRepo(REPO_ROOT)
  if (hits.length === 0) {
    if (!quiet) {
      logger.success(
        '[source-is-windows-portable] no .cmd-shim, url-pathname, or platform-literal findings.',
      )
    }
    return
  }
  if (hits.length <= BASELINE_FINDINGS) {
    if (!quiet) {
      logger.success(
        `[source-is-windows-portable] ${hits.length} finding(s), at or below the introduction baseline (${BASELINE_FINDINGS}) — lower BASELINE_FINDINGS as sites are fixed.`,
      )
    }
    return
  }
  logger.error(
    `[source-is-windows-portable] ${hits.length} finding(s) — ABOVE the ${BASELINE_FINDINGS} baseline (new windows-portability debt):`,
  )
  for (const h of hits) {
    logger.substep(`${h.file}:${h.line} [${h.rule}] ${h.snippet}`)
  }
  logger.log('')
  logger.log('Each class shipped a real windows-only CI failure, failing')
  logger.log('OPEN (skipped gate / silent allow / "flake"). Fixes:')
  logger.group()
  logger.substep(
    'cmd-shim: shell: WIN32 (constants/platform); and prefer async lib `spawn` over `spawnSync` where the caller can await (code-style.md: sync only for CLI bootstrap / hot loops)',
  )
  logger.substep('url-pathname: fileURLToPath(new URL(…)) over .pathname')
  logger.substep('platform-literal: WIN32 over the literal')
  logger.substep(
    'spawn-timeout: spawnTimeoutMs(<ms>) for a local spawn; a network spawn keeps its raw timeout + a `// win-timeout: network` note',
  )
  logger.groupEnd()
  logger.log('Catalog: docs/agents.md/fleet/windows-gotchas.md')
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  void main()
}
