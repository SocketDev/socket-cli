#!/usr/bin/env node
/**
 * @file `setup:python` — sync a uv project's dependencies through the locked
 *   path, so a dev machine gets exactly what CI gets. Self-detecting: skips
 *   with a clear line unless the repo is a uv project (a `pyproject.toml` with
 *   a `[tool.uv]` table, or a `uv.lock`). Requires `uv` (it fails loud with the
 *   install instruction), then runs `uv sync --frozen` per project so the
 *   environment is resolved from the committed `uv.lock` without mutating it.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { findOwnFiles } from '../update/_shared.mts'
import { resolveEcosystemOptions, skipResult } from './ecosystems.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

import type {
  EcosystemStepOptions,
  EcosystemStepResult,
} from './ecosystems.mts'

const mainLogger = getDefaultLogger()

/**
 * True when a `pyproject.toml` body declares a `[tool.uv]` table (or any
 * `[tool.uv.*]` sub-table) — the marker that uv, not another build backend,
 * owns the project. Pure so it is unit-testable with strings.
 */
export function pyprojectDeclaresUv(tomlText: string): boolean {
  return /^\s*\[tool\.uv(?:\.[^\]]+)?\]\s*$/m.test(tomlText)
}

/**
 * True when `dir` sits under a `.claude/` subtree relative to `root` — the
 * committed fleet tooling (security-tool provisioners like
 * headroom/skillspector, hook payloads) whose uv projects are owned by their
 * own installer (`setup-security-tools`), never the host repo's first-party
 * Python. `findOwnFiles` skips build + package-manager output but NOT
 * `.claude/` (nor the cascade's `template/base/.claude/` copies), so this
 * filters the vendored tooling the setup step must not re-sync.
 */
export function isVendoredUvDir(root: string, dir: string): boolean {
  return normalizePath(path.relative(root, dir)).split('/').includes('.claude')
}

/**
 * Every first-party uv project dir under `root`: a dir holding a `uv.lock`, or
 * a `pyproject.toml` whose body declares `[tool.uv]`. Skips vendored / build
 * subtrees via `findOwnFiles`, plus fleet-tooling uv projects under `.claude/`
 * (owned by their own installer). Returns ASCII-sorted absolute dirs.
 */
export function findUvProjects(root: string): string[] {
  const dirs = new Set<string>()
  for (const lock of findOwnFiles(root, name => name === 'uv.lock')) {
    dirs.add(path.dirname(lock))
  }
  for (const proj of findOwnFiles(root, name => name === 'pyproject.toml')) {
    if (pyprojectDeclaresUv(readFileSync(proj, 'utf8'))) {
      dirs.add(path.dirname(proj))
    }
  }
  return [...dirs].filter(dir => !isVendoredUvDir(root, dir)).toSorted()
}

/**
 * The skip reason for `setup:python`, or undefined when the step should run.
 * Pure over the project count so the decision is unit-testable.
 */
export function pythonSkipReason(config: {
  readonly projectCount: number
}): string | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  return cfg.projectCount > 0
    ? undefined
    : 'no uv project (no pyproject.toml with [tool.uv] and no uv.lock)'
}

/**
 * Sync every first-party uv project's environment from its committed `uv.lock`.
 */
export async function setupPython(
  options?: EcosystemStepOptions | undefined,
): Promise<EcosystemStepResult> {
  const { commandExists, logger, repoRoot, runCommand } =
    resolveEcosystemOptions(options)
  const projects = findUvProjects(repoRoot)
  const skip = pythonSkipReason({ projectCount: projects.length })
  if (skip) {
    return skipResult(logger, 'setup:python', skip)
  }
  if (!(await commandExists('uv'))) {
    logger.fail(
      'setup:python: uv is not installed.\n' +
        '  Where: this dev machine (a uv project is present).\n' +
        '  Saw: no uv on PATH; wanted the uv package manager.\n' +
        '  Fix: install uv from https://docs.astral.sh/uv/getting-started/installation/, then re-run pnpm run setup:python.',
    )
    return { ok: false, reason: 'uv not installed', skipped: false }
  }
  for (const dir of projects) {
    logger.log(
      `setup:python — uv sync --frozen (${path.relative(repoRoot, dir) || '.'})`,
    )
    const synced = await runCommand('uv', ['sync', '--frozen'], { cwd: dir })
    if (synced.exitCode !== 0) {
      logger.fail(
        `setup:python: uv sync --frozen failed in ${dir}.\n` +
          `  Where: uv sync --frozen (cwd ${dir}).\n` +
          `  Saw: exit ${synced.exitCode}; wanted the environment resolved from the committed uv.lock.\n` +
          '  Fix: run pnpm run update (or uv lock) to refresh uv.lock, then re-run.',
      )
      return { ok: false, reason: 'uv sync failed', skipped: false }
    }
  }
  logger.log(`setup:python — synced ${projects.length} uv project(s).`)
  return { ok: true, skipped: false }
}

if (isMainModule(import.meta.url)) {
  setupPython().then(
    result => {
      if (!result.ok) {
        process.exitCode = 1
      }
    },
    (e: unknown) => {
      mainLogger.error(e)
      process.exitCode = 1
    },
  )
}
