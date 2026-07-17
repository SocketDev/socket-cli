/**
 * @file Shared helpers for the multi-ecosystem soak-aware update runners
 *   (`brew.mts`, `cargo.mts`, `docker.mts`, `go.mts`, `node.mts`). One home for
 *   the three things every
 *   runner needs identically: the vendored-tree exclusion set, the own-file
 *   walker, and the `--soak-days` trust-gate arg parse. Each runner keeps only
 *   its ecosystem-specific logic (proxy protocol, registry dance, cargo flags).
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * Directory names that hold vendored upstreams, package-manager output, or
 * build output — never this repo's OWN manifests. The walker skips these, plus
 * any `*-bundled` / `*-vendored` sibling.
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'build',
  'coverage',
  'deps',
  'external',
  'node_modules',
  'target',
  'third_party',
  'upstream',
  'vendor',
])

/**
 * True when `name` is a vendored / build directory the walker must not enter.
 */
export function isSkippedDir(name: string): boolean {
  return (
    SKIP_DIRS.has(name) ||
    name.endsWith('-bundled') ||
    name.endsWith('-vendored')
  )
}

/**
 * Every file at or under `root` whose basename satisfies `isMatch`, skipping
 * vendored / build subtrees. Returns absolute, normalized (`/`-separated),
 * sorted paths. Missing / unreadable directories and entries are skipped, never
 * thrown — a scan over a partially-built tree still succeeds.
 */
export function findOwnFiles(
  root: string,
  isMatch: (name: string) => boolean,
): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const name = entries[i]!
      if (isSkippedDir(name)) {
        continue
      }
      const abs = path.join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(abs)
      } else if (isMatch(name)) {
        out.push(normalizePath(abs))
      }
    }
  }
  return out.toSorted()
}

/**
 * Parse + validate the `--soak-days <n>` trust-gate arg (accepts
 * `--soak-days N` and `--soak-days=N`). The soak window is a REQUIRED positive
 * integer supplied by the orchestrator — a missing / zero / negative /
 * fractional value is a hard error (What / Where / Saw / Fix), never a silent
 * default. It is the trust gate; the runner refuses to adopt a 0-day release.
 */
export function requireSoakDays(
  argv: readonly string[],
  toolName: string,
): number {
  let raw: string | undefined
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--soak-days') {
      raw = argv[i + 1]
      break
    }
    if (arg.startsWith('--soak-days=')) {
      raw = arg.slice('--soak-days='.length)
      break
    }
  }
  const soakDays = raw === undefined ? Number.NaN : Number(raw)
  if (!Number.isInteger(soakDays) || soakDays <= 0) {
    throw new Error(
      'Missing or invalid --soak-days.\n' +
        `  Where: ${toolName} CLI args\n` +
        `  Saw: ${raw ?? '(absent)'}; wanted a positive integer day count.\n` +
        '  Fix: pass --soak-days <N>; the orchestrator supplies the fleet soak window.',
    )
  }
  return soakDays
}
