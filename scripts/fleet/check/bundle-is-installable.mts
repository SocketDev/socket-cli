/*
 * @file Release-gate: the fleet bundle must build → install → verify
 *   round-trip cleanly before it ships. Wheelhouse-only — fleet repos don't
 *   produce bundles; when `scripts/repo/validate-release-bundle.mts` is absent
 *   (every cascaded member) this check is a vacuous pass.
 *
 *   Delegates to `validate-release-bundle.mts` which:
 *     1. Calls `makeBundle({ tar: true })` into a temp dir.
 *     2. Installs the tarball into a clean temp dest via `installFleet`
 *        (local-bundle mode — no network, no `gh`).
 *     3. Asserts every manifest.files entry lands with the correct SHA-256,
 *        every segment file contains BEGIN/END fleet-canonical markers, and
 *        every workspace fleet key is present in the merged yaml.
 *   Fail LOUD on any mismatch.
 *
 *   Usage: node scripts/fleet/check/bundle-round-trips.mts
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// `validate-release-bundle.mts` lives under `scripts/repo/` — wheelhouse-only.
// Fleet member repos don't ship it; when absent this check is a vacuous pass.
const VALIDATOR = path.join(
  REPO_ROOT,
  'scripts/repo/validate-release-bundle.mts',
)

export interface BundleFinding {
  detail: string
  fix: string
  kind: string
  path: string
}

/**
 * Render the fail-loud finding block: one `[kind] path` line per finding, each
 * followed by its detail + fix.
 */
export function formatBundleFindings(findings: BundleFinding[]): string {
  return findings
    .map(f => `  [${f.kind}] ${f.path}\n    ${f.detail}\n    Fix: ${f.fix}`)
    .join('\n')
}

export async function main(): Promise<void> {
  if (!existsSync(VALIDATOR)) {
    return
  }
  const { validateBundle } = await import(VALIDATOR)
  const findings = (await validateBundle()) as BundleFinding[]
  if (findings.length === 0) {
    logger.success('bundle-round-trips: all checks passed')
    return
  }
  logger.fail(
    `bundle-round-trips: ${findings.length} problem(s) found:\n` +
      formatBundleFindings(findings),
  )
  process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`[bundle-round-trips] error: ${String(e)}`)
    process.exitCode = 1
  })
}
