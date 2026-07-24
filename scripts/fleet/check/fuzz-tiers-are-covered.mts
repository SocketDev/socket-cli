#!/usr/bin/env node
/*
 * @file Fleet-wide gate: every language present in a repo must carry its
 *   property-and-fuzz-testing tier (the skill at .claude/skills/fleet/
 *   property-and-fuzz-testing). Fuzzing is NON-OPT-IN — a repo that parses
 *   untrusted input without a fuzz tier is the gap this catches. The tiers:
 *     - JS/TS  → at least one `*.fuzz.test.mts` (Tier-1 fast-check) OR
 *                `*.fuzz.ts` (Tier-2 vitiate) under the repo.
 *     - Rust   → `proptest` in a Cargo.toml [dev-dependencies] OR a
 *                `fuzz/fuzz_targets/*.rs` cargo-fuzz target.
 *     - C++    → a libFuzzer harness (a source defining
 *                `LLVMFuzzerTestOneInput`).
 *     - Go     → a `func Fuzz…(…*testing.F)` in some `*_test.go`.
 *
 *   A repo whose code genuinely has no fuzzable boundary opts OUT explicitly by
 *   setting `"fuzz": { "exempt": true, "reason": "<why>" }` in
 *   `.config/repo/socket-wheelhouse.json` — the reason is REQUIRED so an
 *   exemption is a documented decision, not silent rot. Everything else is a
 *   hard error (exit 1). The pure gap-finder `findFuzzTierGaps` is the unit-test
 *   target; `main()` reads the live repo. Usage:
 *     node scripts/fleet/check/fuzz-tiers-are-covered.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Dirs that never hold first-party source (someone else's tree, build output,
// or dependency installs) — skipped when walking for source + fuzz files.
const SKIP_DIRS = new Set([
  '.git',
  '.swc',
  '.vitiate',
  'build',
  'coverage',
  'dist',
  'external',
  'node_modules',
  'out',
  'target',
  'third_party',
  'upstream',
  'vendor',
])

export interface FuzzTierSurfaces {
  readonly isJsTs: boolean
  // A bun-runtime repo (`bun test`): the vitest/SWC-based vitiate lane can't run
  // there, so fast-check via bun:test is the accepted JS/TS tier.
  readonly isBun: boolean
  readonly isRust: boolean
  readonly isCpp: boolean
  readonly isGo: boolean
  readonly hasFastCheck: boolean
  readonly hasVitiate: boolean
  readonly hasRustFuzz: boolean
  readonly hasCppFuzz: boolean
  readonly hasGoFuzz: boolean
  readonly exempt: boolean
  readonly exemptReason: string | undefined
}

/**
 * Gaps between the languages a repo contains and the fuzz tiers it carries.
 * Empty means covered. Pure — the unit-test target. An `exempt` repo has no
 * gaps EXCEPT a missing/blank reason (an exemption must be justified).
 */
export function findFuzzTierGaps(surfaces: FuzzTierSurfaces): string[] {
  const {
    exempt,
    exemptReason,
    hasCppFuzz,
    hasFastCheck,
    hasGoFuzz,
    hasRustFuzz,
    hasVitiate,
    isBun,
    isCpp,
    isGo,
    isJsTs,
    isRust,
  } = surfaces
  if (exempt) {
    if (!exemptReason || !exemptReason.trim()) {
      return [
        'fuzz.exempt is set but fuzz.reason is missing/blank — an exemption must state why (.config/repo/socket-wheelhouse.json).',
      ]
    }
    return []
  }
  const gaps: string[] = []
  if (isJsTs) {
    if (isBun) {
      // bun runtime: the vitest/SWC-based vitiate lane can't run under
      // `bun test`; fast-check via bun:test is the property tier.
      if (!hasFastCheck) {
        gaps.push(
          'JS/TS (bun): no `*.fuzz.test.mts` (fast-check via bun:test) present. Add a property test for an untrusted-input boundary, or set fuzz.exempt with a reason.',
        )
      }
    } else if (!hasVitiate) {
      // node/vitest: the vitiate coverage-guided lane is REQUIRED — a
      // `*.fuzz.test.mts` fast-check test alone is not sufficient.
      gaps.push(
        'JS/TS: no `*.fuzz.ts` (vitiate coverage-guided lane) present — required for node/vitest repos (a `*.fuzz.test.mts` fast-check test alone is not enough). Add a vitiate target (see the property-and-fuzz-testing skill), or set fuzz.exempt with a reason.',
      )
    }
  }
  if (isRust && !hasRustFuzz) {
    gaps.push(
      'Rust: no `proptest` dev-dependency and no `fuzz/fuzz_targets/*.rs` cargo-fuzz target present. Add proptest properties and/or a cargo-fuzz target, or set fuzz.exempt with a reason.',
    )
  }
  if (isCpp && !hasCppFuzz) {
    gaps.push(
      'C++: no libFuzzer harness (a source defining LLVMFuzzerTestOneInput) present. Add one, or set fuzz.exempt with a reason.',
    )
  }
  if (isGo && !hasGoFuzz) {
    gaps.push(
      'Go: no `func Fuzz…(*testing.F)` in any `*_test.go` present. Add a native fuzz target, or set fuzz.exempt with a reason.',
    )
  }
  return gaps
}

/**
 * Walk first-party source under `root`, invoking `visit` for each file's
 * repo-relative path. Skips SKIP_DIRS. Returns early once `visit` returns true
 * (a short-circuit for "does ANY file match").
 */
function walkSource(
  root: string,
  visit: (relPath: string) => boolean,
): boolean {
  const stack: string[] = ['']
  while (stack.length > 0) {
    const rel = stack.pop()!
    const abs = rel ? path.join(root, rel) : root
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const name = entry.name
      const childRel = rel ? `${rel}/${name}` : name
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(name)) {
          stack.push(childRel)
        }
      } else if (visit(childRel)) {
        return true
      }
    }
  }
  return false
}

/**
 * Read the fuzz-exemption from `.config/repo/socket-wheelhouse.json`.
 */
export function readFuzzExemption(root: string): {
  exempt: boolean
  reason: string | undefined
} {
  const configPath = path.join(
    root,
    '.config',
    'repo',
    'socket-wheelhouse.json',
  )
  if (!existsSync(configPath)) {
    return { exempt: false, reason: undefined }
  }
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      fuzz?:
        | { exempt?: unknown | undefined; reason?: unknown | undefined }
        | undefined
    }
    const fuzz = config.fuzz
    return {
      exempt: fuzz?.exempt === true,
      reason: typeof fuzz?.reason === 'string' ? fuzz.reason : undefined,
    }
  } catch {
    return { exempt: false, reason: undefined }
  }
}

// Cascade-owned fleet payload + infra/build scripts are not a fuzzable product
// surface — the tier keys on SHIPPED code. TS under these prefixes never
// counts toward JS/TS language detection (the wheelhouse itself still detects
// via its test/repo TS and keeps its vitiate lane).
export const INFRA_TS_PREFIXES = [
  '.agents/',
  '.claude/',
  '.config/',
  '.git-hooks/',
  'bootstrap/',
  'scripts/',
  'test/fleet/',
] as const

/**
 * Detect languages present + fuzz tiers carried by reading the repo tree.
 */
export function detectFuzzTierSurfaces(root: string): FuzzTierSurfaces {
  const hasPackageJson = existsSync(path.join(root, 'package.json'))
  let isJsTs = false
  let isCpp = false
  let hasFastCheck = false
  let hasVitiate = false
  let hasCppFuzz = false
  let hasGoFuzz = false
  walkSource(root, rel => {
    if (rel.endsWith('.fuzz.test.mts')) {
      hasFastCheck = true
    } else if (rel.endsWith('.fuzz.ts')) {
      hasVitiate = true
    }
    const p = normalizePath(rel)
    if (
      /\.(?:cts|mts|ts)$/.test(p) &&
      !/\.d\.(?:cts|mts|ts)$/.test(p) &&
      !INFRA_TS_PREFIXES.some(pre => p.startsWith(pre))
    ) {
      isJsTs = true
    }
    if (/\.(?:cc|cpp|cxx|cppm)$/.test(rel)) {
      isCpp = true
    }
    if (/\.(?:cc|cpp|cxx)$/.test(rel)) {
      // Cheap content probe only for plausibly-a-harness files.
      if (/fuzz/i.test(rel)) {
        try {
          if (
            readFileSync(path.join(root, rel), 'utf8').includes(
              'LLVMFuzzerTestOneInput',
            )
          ) {
            hasCppFuzz = true
          }
        } catch {}
      }
    }
    if (rel.endsWith('_test.go')) {
      try {
        if (
          /func\s+Fuzz\w*\s*\(/.test(readFileSync(path.join(root, rel), 'utf8'))
        ) {
          hasGoFuzz = true
        }
      } catch {}
    }
    return false
  })
  // A repo is JS/TS if it has a package.json AND first-party TS, so a pure
  // config repo carrying only a package.json isn't forced to fuzz.
  isJsTs = isJsTs && hasPackageJson
  const isRust = existsSync(path.join(root, 'Cargo.toml'))
  const isGo = existsSync(path.join(root, 'go.mod'))
  const hasRustFuzz = detectRustFuzz(root)
  const { exempt, reason } = readFuzzExemption(root)
  return {
    isJsTs,
    isBun: detectBun(root, hasPackageJson),
    isRust,
    isCpp,
    isGo,
    hasFastCheck,
    hasVitiate,
    hasRustFuzz,
    hasCppFuzz,
    hasGoFuzz,
    exempt,
    exemptReason: reason,
  }
}

/**
 * A bun-runtime repo — its `test` script runs `bun test`, or it ships a
 * bunfig.toml. The vitest/SWC-based vitiate lane can't run under `bun test`, so
 * such a repo's JS/TS tier is satisfied by fast-check (via bun:test).
 */
// socket-lint: allow boolean-trap -- internal detector called once with a named
// var (hasPackageJson, already computed by the caller); not a call-site literal.
export function detectBun(root: string, hasPackageJson: boolean): boolean {
  if (existsSync(path.join(root, 'bunfig.toml'))) {
    return true
  }
  if (!hasPackageJson) {
    return false
  }
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, unknown> | undefined }
    const testScript = pkg.scripts?.['test']
    return typeof testScript === 'string' && /\bbun\s+test\b/.test(testScript)
  } catch {
    return false
  }
}

/**
 * Proptest dev-dep in any Cargo.toml, or a cargo-fuzz target under fuzz/.
 */
export function detectRustFuzz(root: string): boolean {
  const fuzzTargetsDir = path.join(root, 'fuzz', 'fuzz_targets')
  try {
    if (readdirSync(fuzzTargetsDir).some(f => f.endsWith('.rs'))) {
      return true
    }
  } catch {}
  let hasProptest = false
  walkSource(root, rel => {
    const relPath = normalizePath(rel)
    if (relPath === 'Cargo.toml' || relPath.endsWith('/Cargo.toml')) {
      try {
        if (
          /^\s*proptest\s*[=.]/m.test(
            readFileSync(path.join(root, rel), 'utf8'),
          )
        ) {
          hasProptest = true
          return true
        }
      } catch {}
    }
    return false
  })
  return hasProptest
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const surfaces = detectFuzzTierSurfaces(REPO_ROOT)
  const gaps = findFuzzTierGaps(surfaces)
  if (gaps.length === 0) {
    if (!quiet) {
      logger.success('fuzz tiers are covered for every language present')
    }
    return
  }
  logger.error('Missing fuzz coverage (fuzzing is non-opt-in):')
  for (let i = 0, { length } = gaps; i < length; i += 1) {
    logger.error(`  - ${gaps[i]}`)
  }
  logger.error(
    'Fix: add the missing tier (property-and-fuzz-testing skill), or set `fuzz.exempt` + `fuzz.reason` in .config/repo/socket-wheelhouse.json.',
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
