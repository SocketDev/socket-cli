#!/usr/bin/env node
/**
 * @fileoverview Repo gate: every tooling config that *can* live in
 * `.config/` *does* live there, and there is no stale duplicate at
 * the repo root.
 *
 * Per CLAUDE.md's "Config files in `.config/`" rule, the root keeps
 * only what *must* be there:
 *   - package manifests + lockfile (package.json, pnpm-lock.yaml,
 *     pnpm-workspace.yaml)
 *   - linter / formatter dotfiles whose tools require root
 *     placement (.oxlintrc.json, .oxfmtrc.json, .npmrc, .gitignore,
 *     .gitattributes, .node-version)
 *   - tsconfig.json (TypeScript's project root anchor — extends
 *     from .config/tsconfig.base.json or .config/tsconfig.json)
 *
 * Everything else (taze.config.mts, vitest.config*.mts,
 * tsconfig.base.json, tsconfig.check.json, tsconfig.dts.json,
 * esbuild.config.mts, lockstep.json, socket-wheelhouse.json, etc.)
 * lives in `.config/`. A copy at root is drift — usually a
 * half-finished move that left a stale file behind.
 *
 * Exit codes:
 *   0 — clean
 *   1 — duplicate(s) found
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')
const configPath = path.join(rootPath, '.config')

// Filename patterns that must live in .config/ when they exist at all,
// and must NOT have a root duplicate. Listed by basename — the gate
// checks both root and .config/ for each.
const CONFIG_BASENAMES: readonly string[] = [
  'esbuild.config.mts',
  'isolated-tests.json',
  'lockstep.json',
  'lockstep.schema.json',
  'oxfmtrc.json',
  'oxlintrc.json',
  'socket-wheelhouse-schema.json',
  'socket-wheelhouse.json',
  'taze.config.mts',
  'tsconfig.base.json',
  'tsconfig.check.json',
  'tsconfig.check.local.json',
  'tsconfig.dts.json',
  'vitest.config.isolated.mts',
  'vitest.config.mts',
  'vitest.coverage.config.mts',
]

// Root dotfile aliases for files that ALSO appear without the dot in
// .config/. e.g. `.oxlintrc.json` is the root-required form (tool
// looks for it at cwd); `oxlintrc.json` is the .config/ form. Both
// are legitimate; the gate verifies only one of each pair is present.
const ROOT_DOT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['.oxlintrc.json', 'oxlintrc.json'],
  ['.oxfmtrc.json', 'oxfmtrc.json'],
]

function main(): void {
  const findings: string[] = []

  // Direct duplicates: same basename at root AND in .config/.
  for (const basename of CONFIG_BASENAMES) {
    const rootCopy = path.join(rootPath, basename)
    const configCopy = path.join(configPath, basename)
    if (existsSync(rootCopy) && existsSync(configCopy)) {
      findings.push(
        `Duplicate config: ${basename} exists at both repo root and .config/. Delete the root copy; .config/ is canonical.`,
      )
    } else if (existsSync(rootCopy)) {
      findings.push(
        `Stale root config: ${basename} should live in .config/, not at the repo root. Move it.`,
      )
    }
  }

  // Dotfile aliases: only ONE of the pair should exist.
  for (const [dotName, plainName] of ROOT_DOT_PAIRS) {
    const dotPath = path.join(rootPath, dotName)
    const plainPath = path.join(configPath, plainName)
    if (existsSync(dotPath) && existsSync(plainPath)) {
      findings.push(
        `Duplicate config: ${dotName} (root) and .config/${plainName} both exist. Keep the .config/ copy; tools accept -c .config/${plainName} explicitly.`,
      )
    }
  }

  if (findings.length === 0) {
    logger.success(
      `Config-path hygiene OK — ${CONFIG_BASENAMES.length} basenames checked, no root duplicates.`,
    )
    return
  }

  logger.error(`Config-path hygiene violations (${findings.length}):`)
  for (const f of findings) {
    logger.error(`  ${f}`)
  }
  process.exitCode = 1
}

main()
