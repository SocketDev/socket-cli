/**
 * @file Audit npm provenance for a published package. Reports per-version:
 *   trustedPublisher status, attestation URL. Usage: node
 *   scripts/fleet/check/provenance-is-attested.mts <name>
 *
 *   # last 10 versions
 *
 *   node scripts/fleet/check/provenance-is-attested.mts <name> --all.
 *
 *   # every published version
 *
 *   node scripts/fleet/check/provenance-is-attested.mts <name> --version 1.2.3.
 *
 *   # one specific version
 *
 *   node scripts/fleet/check/provenance-is-attested.mts <name> --json.
 *
 *   # pipe to jq / scripts
 *
 *   Background — npm publishes a per-version `dist.attestations` block when
 *   `--provenance` was passed to publish (visible at
 *   npmjs.com/package/<name>?activeTab=provenance). It also stamps
 *   `_npmUser.trustedPublisher` when the upload used GitHub Actions OIDC
 *   instead of a classic token. Both signals are independently verifiable via
 *   the registry's JSON packument; see
 *   `publish-shared.mts:fetchVersionTrustInfo`. This script is the audit
 *   surface — run it before / after a release to confirm the new version landed
 *   with the expected trust metadata, or sweep older versions to find ones that
 *   didn't.
 */

import { fileURLToPath } from 'node:url'
import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { fetchVersionTrustInfo } from '../publish-shared.mts'
import type { RegistryVersionInfo } from '../publish-shared.mts'

const logger = getDefaultLogger()

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    options: {
      all: { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
      json: { default: false, type: 'boolean' },
      version: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  })

  if (values['help'] || positionals.length === 0) {
    logger.log(
      'Usage: node scripts/fleet/check/provenance-is-attested.mts <name> [options]',
    )
    logger.log('')
    logger.log('  --all              audit every published version')
    logger.log('  --version <v>      audit a specific version')
    logger.log('  --json             machine-readable output')
    logger.log('')
    logger.log(
      'Without --all or --version, audits the most recent 10 versions.',
    )
    process.exitCode = values['help'] ? 0 : 1
    return
  }

  const name = positionals[0]!
  const versionFilter =
    typeof values['version'] === 'string' ? values['version'] : undefined
  const showAll = !!values['all']
  const json = !!values['json']

  // Use the full packument so we can report trustedPublisher status
  // alongside attestations. The abbreviated packument drops _npmUser.
  const versions = await fetchVersionTrustInfo(name, 'full')
  // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys() already returns a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
  const allVersions = Object.keys(versions).sort(compareSemverDesc)
  if (allVersions.length === 0) {
    logger.fail(`No versions found for ${name} (or registry fetch failed).`)
    process.exitCode = 1
    return
  }

  let target: string[]
  if (versionFilter) {
    if (!versions[versionFilter]) {
      logger.fail(`${name}@${versionFilter} not found on the registry.`)
      process.exitCode = 1
      return
    }
    target = [versionFilter]
  } else if (showAll) {
    target = allVersions
  } else {
    target = allVersions.slice(0, 10)
  }

  if (json) {
    const out: Record<string, ReportRow> = {}
    for (let i = 0, { length } = target; i < length; i += 1) {
      const v = target[i]!
      out[v] = toReportRow(versions[v])
    }
    logger.log(JSON.stringify({ name, versions: out }, null, 2))
    return
  }

  renderTable(name, target, versions)
}

export interface ReportRow {
  attestation: string | undefined
  trustedPublisher: string | undefined
}

export function toReportRow(info: RegistryVersionInfo | undefined): ReportRow {
  return {
    attestation: info?.attestations?.url ?? undefined,
    trustedPublisher: info?.trustedPublisher
      ? `${info.trustedPublisher.id}${info.trustedPublisher.oidcConfigId ? ` (${info.trustedPublisher.oidcConfigId.slice(0, 8)}…)` : ''}`
      : undefined,
  }
}

export function renderTable(
  name: string,
  versions: string[],
  data: Record<string, RegistryVersionInfo>,
): void {
  logger.log('')
  logger.log(`Package: ${name}`)
  logger.log(`Versions audited: ${versions.length}`)
  logger.log('')

  // Compute column widths so the table aligns regardless of input.
  const versionCol = Math.max(
    7,
    versions.reduce((m, v) => Math.max(m, v.length), 0),
  )
  const tpCol = 30
  const headerVersion = 'Version'.padEnd(versionCol)
  const headerTP = 'Trusted Publisher'.padEnd(tpCol)
  const headerAtt = 'Attestation'
  logger.log(`  ${headerVersion}  ${headerTP}  ${headerAtt}`)
  logger.log(
    `  ${'─'.repeat(versionCol)}  ${'─'.repeat(tpCol)}  ${'─'.repeat(11)}`,
  )

  for (let i = 0, { length } = versions; i < length; i += 1) {
    const v = versions[i]!
    const row = toReportRow(data[v])
    const tpDisplay = (row.trustedPublisher ?? '✗ classic-token').padEnd(tpCol)
    const attDisplay = row.attestation ? '✓ provenance' : '✗ none'
    logger.log(`  ${v.padEnd(versionCol)}  ${tpDisplay}  ${attDisplay}`)
  }
  logger.log('')

  const withProvenance = versions.filter(v => data[v]?.attestations).length
  const withTrustedPublisher = versions.filter(
    v => data[v]?.trustedPublisher,
  ).length
  logger.log(
    `Summary: ${withProvenance}/${versions.length} with provenance, ${withTrustedPublisher}/${versions.length} via trusted publisher`,
  )
}

/**
 * Compare two semver strings descending (newest first). Falls back to
 * lexicographic when the strings aren't proper semver — good enough for sorting
 * registry packument versions, which are guaranteed semver-shaped by npm.
 */
export function compareSemverDesc(a: string, b: string): number {
  const pa = a.split('.').map(n => Number.parseInt(n, 10))
  const pb = b.split('.').map(n => Number.parseInt(n, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const ai = pa[i] ?? 0
    const bi = pb[i] ?? 0
    if (!Number.isFinite(ai) || !Number.isFinite(bi)) {
      return b.localeCompare(a)
    }
    if (ai !== bi) {
      return bi - ai
    }
  }
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
