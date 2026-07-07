#!/usr/bin/env node
/**
 * @file `check --all` gate: every Python project that opts into uv (a
 *   `pyproject.toml` with a `[tool.uv]` table) must ship a hash-verified
 *   `uv.lock` AND pin `[tool.uv] exclude-newer` to the fleet soak window.
 *   Without the lock, a CI `uv sync --locked` can't reproduce the install and
 *   an unpinned resolve pulls whatever is latest (the unpinned-`pip3` hazard uv
 *   adoption fixes); without the soak pin, a freshly-published malicious
 *   release is installable. This is the Python analog of the pnpm
 *   `--frozen-lockfile` + `minimumReleaseAge` model. Shares all policy with
 *   `_shared/uv-config.mts` (code is law, DRY). A repo with no uv project (the
 *   common case today) passes vacuously. Exit codes: 0 — every uv project
 *   compliant (or none); 1 — at least one uv project is missing its lock or
 *   soak pin (the per-project fix is printed).
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- sync check script; needs typed string stdout from `git ls-files`, no async.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { inspectUvProject } from '../../../.claude/hooks/fleet/_shared/uv-config.mts'

const logger = getDefaultLogger()

// Enumerate tracked pyproject.toml files via git (respects .gitignore, ignores
// node_modules / vendored trees). Empty / non-git → no files, vacuous pass.
function listPyprojects(): string[] {
  try {
    const result = spawnSync('git', ['ls-files', '*pyproject.toml'], {
      stdio: 'pipe',
    })
    if (result.status !== 0) {
      return []
    }
    const { stdout } = result
    return (typeof stdout === 'string' ? stdout : String(stdout))
      .split(/\r?\n/u)
      .map(s => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

const pyprojects = listPyprojects()
const statuses = pyprojects.map(p => inspectUvProject(p))
const failing = statuses.filter(s => !s.ok)
const uvProjects = statuses.filter(s => s.hasLock || s.issues.length > 0)

if (failing.length === 0) {
  if (uvProjects.length === 0) {
    logger.log('uv lockfiles: no uv projects in this repo (not applicable).')
  } else {
    logger.log(
      `uv lockfiles: ${uvProjects.length} uv project(s) compliant (uv.lock + exclude-newer).`,
    )
  }
  process.exitCode = 0
} else {
  logger.error('')
  logger.error(`[uv-lockfiles] ${failing.length} uv project(s) non-compliant:`)
  for (let i = 0, { length } = failing; i < length; i += 1) {
    const s = failing[i]!
    logger.error(`  ✗ ${s.pyprojectPath}`)
    for (let j = 0, jlen = s.issues.length; j < jlen; j += 1) {
      logger.error(`    - ${s.issues[j]!}`)
    }
  }
  process.exitCode = 1
}
