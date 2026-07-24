/**
 * @file Reporting phase for auditing-gha: runs the audit/conform commands
 *   across a repo list and renders the results — human-readable console
 *   output (with a final tally) or `--json` machine-readable output — then
 *   sets `process.exitCode`. Split out of run.mts to keep it under the
 *   file-size cap; the baseline check/write logic lives in run.mts.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import { auditOne, conformOne } from './run.mts'

const logger = getDefaultLogger()

export interface RepoFinding {
  repo: string
  ok: boolean
  // Each detail line is one fixable item. Empty when ok=true.
  details: string[]
}

export interface ConformResult {
  repo: string
  // True when a PUT was issued (drift existed and was corrected).
  changed: boolean
  // Canonical patterns added by the conform (subset of CANONICAL_PATTERNS).
  added: string[]
  // Set when conform couldn't run (no admin scope / org-governed repo).
  error?: string | undefined
}

export async function runConform(
  repos: readonly string[],
  config: { json: boolean },
): Promise<void> {
  const cfg = { __proto__: null, ...config } as { json: boolean }
  const results: ConformResult[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- serial GH API writes
    results.push(await conformOne(repos[i]!))
  }
  if (cfg.json) {
    logger.info(JSON.stringify(results, null, 2))
  } else {
    for (let i = 0, { length } = results; i < length; i += 1) {
      const r = results[i]!
      if (r.error) {
        logger.warn(`✗ ${r.repo}: ${r.error}`)
      } else if (r.changed) {
        logger.info(
          `✦ ${r.repo}: conformed${
            r.added.length ? ` (+${r.added.join(', +')})` : ''
          }`,
        )
      } else {
        logger.info(`✓ ${r.repo}: already conformant`)
      }
    }
    const errors = results.filter(r => r.error).length
    const changed = results.filter(r => r.changed).length
    logger.info('')
    logger.info(
      `Conformed: ${changed}  Already-ok: ${
        results.length - changed - errors
      }  Errored: ${errors}`,
    )
  }
  // A conform run fails only on a repo it COULDN'T conform (no scope / org-
  // governed) — a successful write is success, not a failure.
  process.exitCode = results.some(r => r.error) ? 1 : 0
}

export async function runAudit(
  repos: readonly string[],
  config: { json: boolean },
): Promise<void> {
  const cfg = { __proto__: null, ...config } as { json: boolean }
  const findings: RepoFinding[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- serial GH API calls
    findings.push(await auditOne(repos[i]!))
  }
  if (cfg.json) {
    logger.info(JSON.stringify(findings, null, 2))
  } else {
    let okCount = 0
    let failCount = 0
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]!
      if (f.ok) {
        okCount += 1
        logger.info(`✓ ${f.repo}`)
      } else {
        failCount += 1
        logger.warn(`✗ ${f.repo}`)
        for (let j = 0, { length: jl } = f.details; j < jl; j += 1) {
          logger.warn(`    ${f.details[j]}`)
        }
      }
    }
    logger.info('')
    logger.info(`OK: ${okCount}  Failed: ${failCount}`)
  }
  process.exitCode = findings.some(f => !f.ok) ? 1 : 0
}
