#!/usr/bin/env node
/**
 * @file `check --all` gate: every `upstream/<name>` reference submodule in
 *   `.gitmodules` is shallow single-branch — it declares `shallow = true` AND a
 *   `branch = <ref>`. A reference submodule vendors an upstream whole-tree for
 *   provenance review (see docs/agents.md/fleet/upstream-references.md), so it
 *   is pinned to one branch and fetched shallow; without both fields a `git
 *   submodule update` drags the branch's full history into every clone. Scope
 *   is the top-level `upstream/` convention only — a nested
 *   `packages/x/upstream/y` conformance submodule is subtree-sparse'd instead
 *   (submodules-are-sparse-or-annotated owns that shape) and is left alone
 *   here. Exit: 0 — every upstream reference is shallow single-branch (or there
 *   are none); 1 — one or more is missing a field. Usage: node
 *   scripts/fleet/check/upstream-submodules-are-shallow-single-branch.mts
 *   [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { parseGitmodules } from '../_shared/gitmodules.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const quiet = process.argv.includes('--quiet')

export interface UpstreamRefOffender {
  // Quoted name from `[submodule "<name>"]`.
  name: string
  // 1-based line of the opening `[submodule …]`.
  line: number
  // Normalized submodule path.
  path: string
  // The required field(s) the block is missing, sorted.
  missing: string[]
}

// Every `upstream/<name>` reference submodule that is not shallow single-branch
// (missing `shallow = true` and/or `branch = <ref>`). Nested `.../upstream/...`
// paths are subtree-sparse conformance submodules, not top-level references, so
// they are out of scope.
export function findOffenders(text: string): UpstreamRefOffender[] {
  const offenders: UpstreamRefOffender[] = []
  for (const entry of parseGitmodules(text)) {
    const normalizedPath = entry.path ? normalizePath(entry.path) : ''
    if (!normalizedPath.startsWith('upstream/')) {
      continue
    }
    const missing: string[] = []
    if (!entry.branch) {
      missing.push('branch = <tracking-ref>')
    }
    if (!entry.shallow) {
      missing.push('shallow = true')
    }
    if (missing.length) {
      offenders.push({
        name: entry.name,
        line: entry.line,
        path: normalizedPath,
        missing,
      })
    }
  }
  return offenders
}

function main(): void {
  const gitmodulesPath = path.join(REPO_ROOT, '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    if (!quiet) {
      logger.log(
        'upstream-submodules-are-shallow-single-branch: no .gitmodules; nothing to check.',
      )
    }
    process.exitCode = 0
    return
  }
  const offenders = findOffenders(readFileSync(gitmodulesPath, 'utf8'))
  if (offenders.length === 0) {
    if (!quiet) {
      logger.log(
        'upstream-submodules-are-shallow-single-branch: every upstream/ reference submodule is shallow single-branch.',
      )
    }
    process.exitCode = 0
    return
  }
  for (const o of offenders) {
    logger.fail(
      `.gitmodules:${o.line} [submodule "${o.name}"] (${o.path}) is missing ${joinAnd(o.missing)} — an upstream/ reference submodule must be shallow single-branch so a clone pulls only the tracked branch tip, not full history. Add the field(s) to the block, e.g. \`git config -f .gitmodules submodule.${o.name}.shallow true\`.`,
    )
  }
  logger.fail(
    `upstream-submodules-are-shallow-single-branch: ${offenders.length} upstream reference submodule(s) not shallow single-branch.`,
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main()
}
