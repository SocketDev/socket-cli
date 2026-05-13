/**
 * @fileoverview lockstep harness CLI entry — dispatcher + `main()`.
 *
 * Reads `lockstep.json` (+ any `includes[]` sub-manifests) and validates each
 * row against its upstream or sibling ports. Every supported `kind` has a
 * checker; a repo populates its manifest only with the kinds it needs.
 *
 * Kinds:
 *   file-fork         vendored upstream file with local deviations;
 *                     drift = upstream moved since our fork SHA.
 *   version-pin       submodule pinned to a specific SHA/tag;
 *                     drift = upstream cut a new release (on default ref).
 *   feature-parity    local impl should match an upstream behavior;
 *                     three-pillar score: code + test + fixture snapshot.
 *   spec-conformance  local impl of an external spec at a known version.
 *   lang-parity       N sibling language ports of one spec;
 *                     drift = port diverged, or rejected anti-pattern
 *                     reintroduced on any port.
 *
 * Exit codes:
 *   0 — manifest valid, no drift.
 *   1 — schema violation, missing file, unreachable baseline, unknown kind.
 *   2 — drift (upstream moved, parity below floor, rejected anti-pattern).
 *
 * Output:
 *   Default — human-readable, compact per-area summary + detailed rows.
 *   `--format=json` or `--json` — single JSON object for CI tooling.
 *
 * Sources and learnings:
 *   - file-fork and version-pin semantics: stuie (this repo).
 *   - feature-parity three-pillar scoring: sdxgen
 *     lock-step-features.json (snapshots replace the 20% tolerance).
 *   - lang-parity ports, rejected anti-pattern, per-area summaries, exit
 *     code 2 semantics: ultrathink/acorn/scripts/xlang-harness.mts.
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import {
  checkCrossRowConsistency,
  checkFeatureParity,
  checkFileFork,
  checkLangParity,
  checkSpecConformance,
  checkVersionPin,
} from './checks.mts'
import { loadManifestTree } from './manifest.mts'
import { emitHuman, summarize } from './report.mts'

import type { Row } from './schema.mts'
import type { Manifest, Report } from './types.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// scripts/lockstep/cli.mts → ../../ is the repo root.
const rootDir = path.resolve(__dirname, '..', '..')

// ---------------------------------------------------------------------------
// Dispatcher.
// ---------------------------------------------------------------------------

function evaluate(
  rowsWithArea: Array<{ row: Row; area: string }>,
  merged: Manifest,
): Report[] {
  const reports: Report[] = []
  for (const { row, area } of rowsWithArea) {
    switch (row.kind) {
      case 'file-fork':
        reports.push(checkFileFork(row, merged, area, rootDir))
        break
      case 'version-pin':
        reports.push(checkVersionPin(row, merged, area, rootDir))
        break
      case 'feature-parity':
        reports.push(checkFeatureParity(row, merged, area, rootDir))
        break
      case 'spec-conformance':
        reports.push(checkSpecConformance(row, merged, area, rootDir))
        break
      case 'lang-parity':
        reports.push(checkLangParity(row, merged, area))
        break
      default: {
        const anyRow = row as { kind: string; id: string }
        reports.push({
          kind: 'file-fork',
          area,
          id: anyRow.id,
          severity: 'error',
          messages: [`no checker registered for kind '${anyRow.kind}'`],
          local: '',
          upstream: '',
          upstream_path: '',
          forked_at_sha: '',
          drift: [],
        })
        process.exitCode = 1
      }
    }
  }
  return reports
}

function main(): void {
  const rootManifestPath = path.join(rootDir, 'lockstep.json')
  const { areas, merged } = loadManifestTree(rootManifestPath)

  const rowsWithArea: Array<{ row: Row; area: string }> = []
  for (const { area, manifest } of areas) {
    for (const row of manifest.rows) {
      rowsWithArea.push({ row, area })
    }
  }

  const crossRowErrors = checkCrossRowConsistency(rowsWithArea, merged)
  if (crossRowErrors.length > 0) {
    for (const err of crossRowErrors) {
      logger.fail(err)
    }
    logger.error(
      `lockstep: ${crossRowErrors.length} cross-row error(s) — fix before running drift checks`,
    )
    process.exit(1)
  }

  const reports = evaluate(rowsWithArea, merged)
  const summaries = summarize(reports)

  const jsonMode =
    process.argv.includes('--json') || process.argv.includes('--format=json')

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ reports, summaries }, null, 2) + '\n')
    const anyError = reports.some(r => r.severity === 'error')
    const anyDrift = reports.some(r => r.severity === 'drift')
    if (anyError) {
      process.exitCode = 1
    } else if (anyDrift) {
      process.exitCode = 2
    }
    return
  }

  const code = emitHuman(reports, summaries)
  if (code !== 0) {
    process.exitCode = code
  }
}

main()
