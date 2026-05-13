/**
 * @fileoverview Human-readable rendering for lockstep reports.
 *
 * `summarize` produces the per-area roll-up (total / ok / drift / error
 * counts, sorted by area name) consumed at the top of the human output
 * and embedded in the `--json` payload.
 *
 * `emitHuman` is the default formatter; it writes the per-area summary
 * table and then each row's detail block (banner, kind-specific facts,
 * accumulated messages, file-fork drift commits). The return value is
 * the exit code: 0 = clean, 1 = error in any row, 2 = drift in any row
 * (per the harness contract documented at the top of `cli.mts`).
 *
 * Learned from ultrathink xlang-harness.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import type { Report } from './types.mts'

const logger = getDefaultLogger()

export interface AreaSummary {
  area: string
  total: number
  ok: number
  drift: number
  error: number
}

export function summarize(reports: Report[]): AreaSummary[] {
  const byArea = new Map<string, AreaSummary>()
  for (const r of reports) {
    let s = byArea.get(r.area)
    if (!s) {
      s = { area: r.area, total: 0, ok: 0, drift: 0, error: 0 }
      byArea.set(r.area, s)
    }
    s.total += 1
    s[r.severity] += 1
  }
  return [...byArea.values()].sort((a, b) => a.area.localeCompare(b.area))
}

export function emitHuman(
  reports: Report[],
  summaries: AreaSummary[],
): number {
  logger.info(
    `lockstep — ${reports.length} row(s) across ${summaries.length} area(s)`,
  )
  logger.info('')
  for (const s of summaries) {
    const label = s.area.padEnd(24)
    const parts = `total=${String(s.total).padStart(3)}  ok=${String(s.ok).padStart(3)}  drift=${String(s.drift).padStart(3)}  error=${String(s.error).padStart(3)}`
    logger.info(`  ${label}${parts}`)
  }
  logger.info('')

  let hadError = false
  let hadDrift = false
  for (const r of reports) {
    const banner = `[${r.area}/${r.id}] (${r.kind})`
    if (r.kind === 'file-fork') {
      logger.info(banner)
      logger.info(`  local: ${r.local}`)
      logger.info(
        `  upstream: ${r.upstream}:${r.upstream_path} @ ${r.forked_at_sha.slice(0, 12)}`,
      )
    } else if (r.kind === 'version-pin') {
      logger.info(banner)
      const tag = r.pinned_tag ? ` (${r.pinned_tag})` : ''
      logger.info(
        `  upstream: ${r.upstream} @ ${r.pinned_sha.slice(0, 12)}${tag}, policy=${r.upgrade_policy}`,
      )
    } else if (r.kind === 'feature-parity') {
      logger.info(banner)
      logger.info(
        `  upstream: ${r.upstream}, local_area: ${r.local_area}, criticality: ${r.criticality}`,
      )
      logger.info(
        `  scores: code=${r.code_score} test=${r.test_score} fixture=${r.fixture_score} total=${r.total_score}`,
      )
    } else if (r.kind === 'spec-conformance') {
      logger.info(banner)
      logger.info(
        `  upstream: ${r.upstream}, local_impl: ${r.local_impl}, spec_version: ${r.spec_version}`,
      )
    } else if (r.kind === 'lang-parity') {
      logger.info(banner)
      logger.info(`  category: ${r.category}`)
      for (const [port, state] of Object.entries(r.ports)) {
        const suffix =
          state.status === 'opt-out' ? ` (${state.reason ?? ''})` : ''
        logger.info(`    ${port}: ${state.status}${suffix}`)
      }
    }

    for (const msg of r.messages) {
      if (r.severity === 'error') {
        logger.fail(`  ${msg}`)
      } else if (r.severity === 'drift') {
        logger.warn(`  ${msg}`)
      } else {
        logger.info(`  ${msg}`)
      }
    }

    if (r.kind === 'file-fork') {
      for (const c of r.drift) {
        logger.info(`    ${c.sha.slice(0, 12)} ${c.summary}`)
      }
    }

    if (r.severity === 'ok') {
      logger.success(`  ok`)
    } else if (r.severity === 'error') {
      hadError = true
    } else if (r.severity === 'drift') {
      hadDrift = true
    }
    logger.info('')
  }

  if (hadError) {
    return 1
  }
  if (hadDrift) {
    return 2
  }
  return 0
}
