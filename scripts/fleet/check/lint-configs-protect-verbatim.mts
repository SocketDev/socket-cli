#!/usr/bin/env node
// check --all gate: a lint/format config's verbatim-file exclusions must never
// be overridable by a later re-include. Why this exists: the wheelhouse dogfood
// oxlint config re-includes 'template/' so oxlint lints the fleet SOURCE — but
// a broad '!**/template/**' placed AFTER the verbatim excludes silently
// re-exposes verbatim upstream files (an upstream/ reference tree, the Go
// toolchain's wasm_exec.js). An 'oxlint --fix' over that scope then rewrites
// them — the export-top-level-functions autofix has turned verbatim CJS glue
// into invalid ESM before, breaking require(). The ignore paths were applied;
// they were just wrong. Invariant: in any oxlint config whose ignorePatterns
// contains a ! negation, each protected-verbatim glob must appear AFTER the
// last negation (gitignore last-match wins, so the protection holds even inside
// a re-included tree).
//
// Usage: node scripts/fleet/check/lint-configs-protect-verbatim.mts [--quiet]

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Verbatim upstream / generated files that lint AND --fix must never touch, no
// matter what a re-include says. Globs as they appear in oxlint ignorePatterns.
export const PROTECTED_VERBATIM_GLOBS: readonly string[] = [
  '**/upstream/**',
  '**/wasm_exec.js',
]

// oxlint configs that carry an ignorePatterns array (fleet canonical + repo
// overlays, including the wheelhouse-only dogfood config that re-includes
// template/).
const OXLINT_CONFIGS: readonly string[] = [
  '.config/fleet/oxlintrc.json',
  '.config/repo/oxlintrc.dogfood.json',
  '.config/repo/oxlintrc.json',
]

interface OxlintConfigShape {
  ignorePatterns?: string[] | undefined
}

/**
 * The protected-verbatim globs a `!` re-include leaves re-exposed in one
 * ignorePatterns array: present in the list but last-seen BEFORE the last
 * negation (so the negation re-includes them). Empty = safe. Pure.
 */
export function reexposedVerbatim(patterns: readonly string[]): string[] {
  let lastNeg = -1
  for (let i = 0, { length } = patterns; i < length; i += 1) {
    if (patterns[i]!.startsWith('!')) {
      lastNeg = i
    }
  }
  if (lastNeg === -1) {
    return []
  }
  const out: string[] = []
  for (let i = 0, { length } = PROTECTED_VERBATIM_GLOBS; i < length; i += 1) {
    const glob = PROTECTED_VERBATIM_GLOBS[i]!
    const lastIdx = patterns.lastIndexOf(glob)
    if (lastIdx !== -1 && lastIdx < lastNeg) {
      out.push(glob)
    }
  }
  return out
}

/**
 * Offending `<config>: <re-exposed globs>` lines across the wheelhouse oxlint
 * configs. Empty when every config keeps its verbatim excludes un-overridable.
 */
export function findReexposedVerbatim(repoRoot: string): string[] {
  const offenders: string[] = []
  for (let i = 0, { length } = OXLINT_CONFIGS; i < length; i += 1) {
    const rel = OXLINT_CONFIGS[i]!
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) {
      continue
    }
    let cfg: OxlintConfigShape
    try {
      cfg = JSON.parse(readFileSync(abs, 'utf8')) as OxlintConfigShape
    } catch {
      continue
    }
    const patterns = Array.isArray(cfg.ignorePatterns) ? cfg.ignorePatterns : []
    const exposed = reexposedVerbatim(patterns)
    if (exposed.length) {
      offenders.push(`${rel}: ${exposed.join(', ')}`)
    }
  }
  return offenders
}

function main(): number {
  const offenders = findReexposedVerbatim(REPO_ROOT)
  if (offenders.length) {
    logger.fail(
      '[lint-configs-protect-verbatim] a `!` re-include re-exposes verbatim files to lint/--fix:',
    )
    for (let i = 0, { length } = offenders; i < length; i += 1) {
      logger.error(`  ✗ ${offenders[i]!}`)
    }
    logger.error(
      '  Move the protected-verbatim globs AFTER the last `!` negation so the',
    )
    logger.error(
      '  gitignore last-match keeps them excluded from lint + --fix.',
    )
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      '[lint-configs-protect-verbatim] verbatim exclusions are not re-includable.',
    )
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  main()
}
