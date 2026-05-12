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
 *     from .config/tsconfig.base.json)
 *
 * Everything else (taze.config.mts, vitest.config*.mts,
 * tsconfig.base.json, esbuild.config.mts, lockstep.json,
 * socket-wheelhouse.json, etc.) lives in `.config/`. A copy at root
 * is drift — usually a half-finished move that left a stale file
 * behind.
 *
 * `tsconfig.base.json` is the abstract compiler-options layer
 * (fleet-canonical, byte-identical across the fleet) and stays in
 * `.config/`. *Concrete* tsconfigs (`tsconfig.json`,
 * `tsconfig.check.json`, `tsconfig.dts.json`, etc. — anything with
 * `include`/`exclude`/`files`) live at the package root: at repo root
 * for single-package repos, at each `packages/<pkg>/` for monorepos.
 * tsc discovers `tsconfig.json` at cwd natively; keeping the concrete
 * elsewhere breaks IDE language-server discovery and forces every
 * caller to pass `-p <path>` explicitly.
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

// Concrete tsconfig basenames — these must NOT live in `.config/`.
// They have `include`/`exclude` and belong at the package root so tsc
// + IDE can discover them natively. The abstract layer
// (`tsconfig.base.json`) stays in `.config/` and is in
// `CONFIG_BASENAMES` above.
const CONCRETE_TSCONFIG_BASENAMES: readonly string[] = [
  'tsconfig.json',
  'tsconfig.check.json',
  'tsconfig.check.local.json',
  'tsconfig.dts.json',
  'tsconfig.test.json',
  'tsconfig.build.json',
  'tsconfig.declaration.json',
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

  // Concrete tsconfigs must NOT live in `.config/`. They belong at the
  // repo root (single-package) or each `packages/<pkg>/` (monorepo).
  // tsc + IDE discover them natively at cwd; burying them in `.config/`
  // breaks language-server lookups and forces explicit `-p <path>`.
  for (const basename of CONCRETE_TSCONFIG_BASENAMES) {
    const configCopy = path.join(configPath, basename)
    if (existsSync(configCopy)) {
      findings.push(
        `Concrete tsconfig in .config/: .config/${basename} should live at the package root, not in .config/. Move it (single-package: repo root; monorepo: packages/<pkg>/).`,
      )
    }
  }

  if (findings.length === 0) {
    const total =
      CONFIG_BASENAMES.length + CONCRETE_TSCONFIG_BASENAMES.length
    logger.success(
      `Config-path hygiene OK — ${total} basenames checked, no drift.`,
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
