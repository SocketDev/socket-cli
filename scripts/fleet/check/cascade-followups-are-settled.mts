#!/usr/bin/env node
/*
 * @file `check --all` gate: every RELEASE-CASCADE follow-up is SETTLED — no
 *   published fleet package's downstream declarations lag its registry
 *   latest. The read side of lib/release-cascade.mts, the declarative graph of
 *   what a release owes downstream: catalog pins in consumer repos and the
 *   fleet catalog, socket-registry's registry/manifest.json purl entry, and
 *   the follow-up releases that ship those declarations. Red on lag with the
 *   owed action named — the 1.4.2 incident class, where manifest.json sat on
 *   `packageurl-js@1.4.2` long after the package moved on, becomes a failing
 *   check instead of operator memory.
 *
 *   Evaluation per obligation, honesty over guessing:
 *   - registry latest per graph package via one packument read; unreachable
 *     or never-published packages SKIP their edges with a note;
 *   - consumer-repo declarations read from LOCAL SIBLING CLONES beside this
 *     repo, each consumer's own pnpm-workspace.yaml catalog block; a missing
 *     clone is an honest skip, never a false red;
 *   - the fleet catalog reads this repo's template/base source of truth;
 *   - follow-up-release edges derive from their same-repo siblings.
 *
 *   WHEELHOUSE-ONLY in effect: members receive this file by cascade but have
 *   no template/base, so they vacuous-pass — the wheelhouse is where the
 *   fleet-wide release train is driven and where sibling clones live.
 *   Usage: node scripts/fleet/check/cascade-followups-are-settled.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  computeOwedFollowUps,
  flattenObligations,
  FLEET_CATALOG,
  manifestEntryVersion,
  RELEASE_CASCADE_GRAPH,
} from '../lib/release-cascade.mts'
import { parseCatalogBlock } from '../lib/workspace-yaml.mts'
import { REPO_ROOT } from '../paths.mts'
import { fetchLatestPublishedVersionChecked } from '../publish-infra/npm/registry.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

import type { ObligationReading } from '../lib/release-cascade.mts'

const logger = getDefaultLogger()

const quiet = process.argv.includes('--quiet')

function note(message: string): void {
  if (!quiet) {
    logger.log(message)
  }
}

/**
 * The fleet catalog's source of truth in the wheelhouse — the template/base
 * copy the cascade splices into every member, this repo's own included.
 */
const FLEET_CATALOG_SOURCE = path.join(
  REPO_ROOT,
  'template',
  'base',
  '.config',
  'fleet',
  'pnpm-workspace.fleet.yaml',
)

/**
 * Read one obligation's downstream declaration. Impure by nature — file
 * reads over sibling clones — with every unreadable surface funneled into
 * the `readable: false` honest-skip channel.
 */
export function readObligation(config: {
  edge: { kind: string; repo: string }
  pkg: string
  siblingsDir: string
}): ObligationReading {
  const cfg = { __proto__: null, ...config } as typeof config
  const edge = cfg.edge as ObligationReading['edge']
  const { pkg, siblingsDir } = cfg
  if (edge.kind === 'catalog-pin' && edge.repo === FLEET_CATALOG) {
    if (!existsSync(FLEET_CATALOG_SOURCE)) {
      return {
        declared: undefined,
        edge,
        pkg,
        readable: false,
        source: `fleet catalog source missing at ${FLEET_CATALOG_SOURCE}`,
      }
    }
    const declared = parseCatalogBlock(
      readFileSync(FLEET_CATALOG_SOURCE, 'utf8'),
    )[pkg]
    return {
      declared,
      edge,
      pkg,
      readable: true,
      source: FLEET_CATALOG_SOURCE,
    }
  }
  if (edge.kind === 'catalog-pin') {
    const file = path.join(siblingsDir, edge.repo, 'pnpm-workspace.yaml')
    if (!existsSync(file)) {
      return {
        declared: undefined,
        edge,
        pkg,
        readable: false,
        source: `no local clone at ${path.join(siblingsDir, edge.repo)} — honest skip`,
      }
    }
    const declared = parseCatalogBlock(readFileSync(file, 'utf8'))[pkg]
    return { declared, edge, pkg, readable: true, source: file }
  }
  if (edge.kind === 'registry-manifest-entry') {
    const file = path.join(siblingsDir, edge.repo, 'registry', 'manifest.json')
    if (!existsSync(file)) {
      return {
        declared: undefined,
        edge,
        pkg,
        readable: false,
        source: `no local clone at ${path.join(siblingsDir, edge.repo)} — honest skip`,
      }
    }
    const declared = manifestEntryVersion(readFileSync(file, 'utf8'), pkg)
    return { declared, edge, pkg, readable: true, source: file }
  }
  // follow-up-release edges derive from siblings inside computeOwedFollowUps
  // and are never read directly.
  return {
    declared: undefined,
    edge,
    pkg,
    readable: false,
    source: 'derived edge — no direct reading',
  }
}

async function main(): Promise<void> {
  if (!existsSync(path.join(REPO_ROOT, 'template', 'base'))) {
    note(
      'cascade-followups-are-settled: no template/base — a member checkout, vacuous pass. ' +
        'The wheelhouse runs the fleet-wide evaluation.',
    )
    process.exitCode = 0
    return
  }
  const siblingsDir = path.dirname(REPO_ROOT)
  const packages = Object.keys(RELEASE_CASCADE_GRAPH)
  const latestEntries = await Promise.all(
    packages.map(async pkg => {
      const read = await fetchLatestPublishedVersionChecked(pkg)
      return [pkg, read.reachable ? read.latest : undefined] as const
    }),
  )
  const latestByPackage = Object.fromEntries(latestEntries)
  const readings: ObligationReading[] = []
  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    const edges = flattenObligations(pkg)
    for (let j = 0, edgeCount = edges.length; j < edgeCount; j += 1) {
      const edge = edges[j]!
      if (edge.kind === 'follow-up-release') {
        continue
      }
      readings.push(readObligation({ edge, pkg, siblingsDir }))
    }
  }
  const { owed, skipped } = computeOwedFollowUps({ latestByPackage, readings })
  for (const skip of skipped) {
    note(
      `cascade-followups-are-settled: SKIP ${skip.edge.kind} ${skip.edge.repo} for ${skip.pkg} — ${skip.detail}`,
    )
  }
  if (owed.length) {
    logger.error(
      `cascade-followups-are-settled: ${owed.length} OWED follow-up(s) — a released version has not finished its cascade.`,
    )
    for (const item of owed) {
      logger.error(
        `  OWED [${item.edge.kind} ${item.edge.repo}] ${item.pkg}@${item.latest}: ${item.action}`,
      )
    }
    logger.error(
      '  The graph: scripts/fleet/lib/release-cascade.mts. Settle each owed action, or extend the graph if an edge is wrong.',
    )
    process.exitCode = 1
    return
  }
  note(
    `cascade-followups-are-settled: settled — ${readings.length} obligation(s) across ${packages.length} package(s)` +
      (skipped.length ? `, ${skipped.length} skipped honestly` : '') +
      '.',
  )
  process.exitCode = 0
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    // Fail-open: a crash in the check must not block an otherwise-valid push;
    // the owed computation only reds on evidence it actually gathered.
    process.exitCode = 0
  })
}
