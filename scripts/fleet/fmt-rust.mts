/**
 * @file Owning formatter for a repo's first-party Rust: run `cargo fmt` for
 *   every cargo workspace in the tree, skipping vendored/generated code. The
 *   root rustfmt.toml (fleet 2-space style) governs every run. Modes:
 *   node scripts/fleet/fmt-rust.mts           # rewrite
 *   node scripts/fleet/fmt-rust.mts --check   # verify only (CI / pre-push)
 *   A Cargo.toml nested under another discovered manifest's directory is a
 *   workspace member — `cargo fmt --all` at the outer root already covers it,
 *   so only the outermost manifests run.
 */

// prefer-async-spawn: sync-required — sequential CLI gates, exit-code
// aggregation.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const logger = getDefaultLogger()

const check = process.argv.includes('--check')

// Directories whose Rust is not ours to format: vendored/upstream drops,
// package-manager output, build output, and per-checkout caches.
const SKIP_DIRS = new Set([
  '.git',
  'coverage',
  'deps',
  'external',
  'node_modules',
  'target',
  'third_party',
  'upstream',
  'vendor',
])

export function findWorkspaceManifests(root: string): string[] {
  const manifests: string[] = []
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
      if (
        SKIP_DIRS.has(name) ||
        name.endsWith('-bundled') ||
        name.endsWith('-vendored')
      ) {
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
      } else if (name === 'Cargo.toml') {
        manifests.push(abs)
      }
    }
  }
  // Outermost manifests only: drop any manifest nested under another
  // manifest's directory (a workspace member `cargo fmt --all` covers).
  const sorted = manifests
    .map(m => normalizePath(m))
    .toSorted((a, b) => a.length - b.length)
  const roots: string[] = []
  for (let i = 0, { length } = sorted; i < length; i += 1) {
    const m = sorted[i]!
    if (!roots.some(r => m.startsWith(`${path.posix.dirname(r)}/`))) {
      roots.push(m)
    }
  }
  return roots
}

function main(): void {
  const repoRoot = process.cwd()
  const manifests = findWorkspaceManifests(repoRoot)
  if (!manifests.length) {
    logger.info('fmt-rust: no Cargo.toml found; nothing to format.')
    return
  }
  let failed = false
  for (let i = 0, { length } = manifests; i < length; i += 1) {
    const manifest = manifests[i]!
    logger.info(
      `fmt-rust: cargo fmt --all (${path.relative(repoRoot, manifest)})`,
    )
    const result = spawnSync(
      'cargo',
      [
        'fmt',
        '--all',
        '--manifest-path',
        manifest,
        ...(check ? ['--check'] : []),
      ],
      { stdio: 'inherit' },
    )
    if (result.status !== 0) {
      failed = true
    }
  }
  if (failed) {
    logger.fail(
      check
        ? 'fmt-rust: formatting drift found. Fix: node scripts/fleet/fmt-rust.mts'
        : 'fmt-rust: cargo fmt failed.',
    )
    process.exitCode = 1
    return
  }
  logger.info('fmt-rust: clean.')
}

main()
