#!/usr/bin/env node
/**
 * @file Enforce that every `-stable` catalog alias tracks its base version. A
 *   Socket package carries a floating base entry (`@socketsecurity/lib:
 *   6.0.10`) and a pinned alias (`@socketsecurity/lib-stable:
 *   'npm:@socketsecurity/lib@6.0.10'`) that code imports for a version-locked
 *   surface. "Update <socket-pkg> = its -stable alias too" (CLAUDE.md
 *   vocabulary) — when a dep bump moves the base and leaves the alias behind,
 *   every `import … from '@socketsecurity/lib-stable'` resolves an OLDER build
 *   than the catalog ships, a silent version skew across the fleet. Scans both
 *   catalog surfaces: the live `pnpm-workspace.yaml` (what pnpm resolves) and
 *   the fleet catalog source `.config/fleet/pnpm-workspace.fleet.yaml` (the
 *   cascade-canonical source members inherit). Fail loud on any desync; `pnpm
 *   run fix` (reconcileStableAliases) auto-syncs. Exit 0 = in sync, exit 1 =
 *   desync. CI gate via scripts/fleet/check.mts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  FLEET_CATALOG_YAML,
  PNPM_WORKSPACE_YAML,
  REPO_ROOT,
} from '../paths.mts'
import { findStableAliasDesyncs } from '../lib/stable-alias.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The cascade-source catalogs under `template/base/` (wheelhouse-only). A
// desync HERE re-seeds the live files on the next cascade, so the source must
// be caught too — absent in a member repo, where the loop simply skips them.
const TEMPLATE_WORKSPACE_YAML = path.join(
  REPO_ROOT,
  'template',
  'base',
  'pnpm-workspace.yaml',
)
const TEMPLATE_FLEET_CATALOG_YAML = path.join(
  REPO_ROOT,
  'template',
  'base',
  '.config',
  'fleet',
  'pnpm-workspace.fleet.yaml',
)

export function runCheck(): number {
  const findings: string[] = []
  for (const file of [
    PNPM_WORKSPACE_YAML,
    FLEET_CATALOG_YAML,
    TEMPLATE_WORKSPACE_YAML,
    TEMPLATE_FLEET_CATALOG_YAML,
  ]) {
    if (!existsSync(file)) {
      continue
    }
    const rel = path.relative(REPO_ROOT, file)
    for (const d of findStableAliasDesyncs(readFileSync(file, 'utf8'))) {
      findings.push(
        `    - ${rel}: '${d.alias}' pins ${d.aliasVersion}, base '${d.base}' is ${d.baseVersion}`,
      )
    }
  }
  if (findings.length === 0) {
    return 0
  }
  logger.fail(
    [
      '[check-stable-aliases-match-base] `-stable` alias(es) out of sync with their base.',
      '',
      '  A `-stable` catalog alias must pin the SAME version as its floating',
      '  base entry — otherwise imports of the `-stable` surface resolve an',
      '  older build than the catalog ships. "Update a Socket package = update',
      '  its -stable alias too."',
      '',
      ...findings,
      '',
      '  Fix: `pnpm run fix` (reconcileStableAliases syncs each alias to its',
      '  base version), then re-cascade so members inherit the fix.',
      '',
    ].join('\n'),
  )
  return 1
}

function main(): void {
  process.exitCode = runCheck()
}

if (isMainModule(import.meta.url)) {
  main()
}
