import colors from 'yoctocolors-cjs'

import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'

// This is a simplified view of an artifact. Potentially merged with other artifacts.
interface DedupedArtifact {
  ecosystem: string // artifact.type
  namespace: string
  name: string
  version: string
  score: {
    supplyChain: number
    maintenance: number
    quality: number
    vulnerability: number
    license: number
  }
  alerts: Map<
    string,
    {
      type: string
      severity: string
    }
  >
}

export function outputPurlsShallowScore(
  purls: string[],
  result: CResult<SocketArtifact[]>,
  outputKind: OutputKind,
): void {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { missing, rows } = preProcess(result.data, purls)

  if (outputKind === 'markdown') {
    const md = generateMarkdownReport(rows, missing)
    logger.log(md)
    return
  }

  const txt = generateTextReport(rows, missing)
  logger.log(txt)
}

function formatReportCard(artifact: DedupedArtifact, color: boolean): string {
  const scoreResult = {
    'Supply Chain Risk': Math.floor((artifact.score?.supplyChain ?? 0) * 100),
    Maintenance: Math.floor((artifact.score?.maintenance ?? 0) * 100),
    Quality: Math.floor((artifact.score?.quality ?? 0) * 100),
    Vulnerabilities: Math.floor((artifact.score?.vulnerability ?? 0) * 100),
    License: Math.floor((artifact.score?.license ?? 0) * 100),
  }
  const alertString = getAlertString(artifact.alerts, !color)
  if (!artifact.ecosystem) {
    debugFn('notice', 'miss: artifact ecosystem', artifact)
  }
  const purl = `pkg:${artifact.ecosystem}/${artifact.name}${artifact.version ? '@' + artifact.version : ''}`

  return [
    'Package: ' + (color ? colors.bold(purl) : purl),
    '',
    ...Object.entries(scoreResult).map(
      score =>
        `- ${score[0]}:`.padEnd(20, ' ') +
        `  ${formatScore(score[1], !color, true)}`,
    ),
    alertString,
  ].join('\n')
}

function formatScore(score: number, noColor = false, pad = false): string {
  const padded = String(score).padStart(pad ? 3 : 0, ' ')
  if (noColor) {
    return padded
  }
  if (score >= 80) {
    return colors.green(padded)
  }
  if (score >= 60) {
    return colors.yellow(padded)
  }
  return colors.red(padded)
}

function getAlertString(
  alerts: DedupedArtifact['alerts'],
  noColor = false,
): string {
  if (!alerts.size) {
    return noColor ? `- Alerts: none!` : `- Alerts: ${colors.green('none')}!`
  }

  const arr = Array.from(alerts.values())
  const bad = arr
    .filter(alert => alert.severity !== 'low' && alert.severity !== 'middle')
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  const mid = arr
    .filter(alert => alert.severity === 'middle')
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  const low = arr
    .filter(alert => alert.severity === 'low')
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))

  // We need to create the no-color string regardless because the actual string
  // contains a bunch of invisible ANSI chars which would screw up length checks.
  const colorless = `- Alerts (${bad.length}/${mid.length.toString()}/${low.length}):`

  if (noColor) {
    return (
      colorless +
      ' '.repeat(Math.max(0, 20 - colorless.length)) +
      '  ' +
      [
        bad.map(alert => `[${alert.severity}] ` + alert.type).join(', '),
        mid.map(alert => `[${alert.severity}] ` + alert.type).join(', '),
        low.map(alert => `[${alert.severity}] ` + alert.type).join(', '),
      ]
        .filter(Boolean)
        .join(', ')
    )
  }
  return (
    `- Alerts (${colors.red(bad.length.toString())}/${colors.yellow(mid.length.toString())}/${low.length}):` +
    ' '.repeat(Math.max(0, 20 - colorless.length)) +
    '  ' +
    [
      bad
        .map(alert =>
          colors.red(colors.dim(`[${alert.severity}] `) + alert.type),
        )
        .join(', '),
      mid
        .map(alert =>
          colors.yellow(colors.dim(`[${alert.severity}] `) + alert.type),
        )
        .join(', '),
      low
        .map(alert => colors.dim(`[${alert.severity}] `) + alert.type)
        .join(', '),
    ]
      .filter(Boolean)
      .join(', ')
  )
}

export function preProcess(
  artifacts: SocketArtifact[],
  requestedPurls: string[],
): { rows: Map<string, DedupedArtifact>; missing: string[] } {
  // Dedupe results (for example, pypi will emit one package for each system release (win/mac/cpu) even if it's
  // the same package version with same results. The duplication is irrelevant and annoying to the user.

  // Make some effort to match the requested data with the response
  // Dedupe and merge results when only the .release value is different

  // API does not tell us which purls were not found.
  // Generate all purls to try so we can try to match search request.
  const purls: Set<string> = new Set()
  artifacts.forEach(data => {
    purls.add(
      `pkg:${data.type}/${data.namespace ? `${data.namespace}/` : ''}${data.name}@${data.version}`,
    )
    purls.add(`pkg:${data.type}/${data.name}@${data.version}`)
    purls.add(`pkg:${data.type}/${data.name}`)
    purls.add(
      `pkg:${data.type}/${data.namespace ? `${data.namespace}/` : ''}${data.name}`,
    )
  })
  // Try to match the searched purls against this list
  const missing = requestedPurls.filter(purl => {
    if (purls.has(purl)) {
      return false
    }
    if (
      purl.endsWith('@latest') &&
      purls.has(purl.slice(0, -'@latest'.length))
    ) {
      return false
    }
    return true // not found
  })

  // Create a unique set of rows which represents each artifact that is returned
  // while deduping when the artifact (main) meta data only differs due to the
  // .release field (observed with python, at least).
  // Merge the alerts for duped packages. Use lowest score between all of them.
  const rows: Map<string, DedupedArtifact> = new Map()
  artifacts.forEach(artifact => {
    const purl = `pkg:${artifact.type}/${artifact.namespace ? `${artifact.namespace}/` : ''}${artifact.name}${artifact.version ? `@${artifact.version}` : ''}`
    if (rows.has(purl)) {
      const row = rows.get(purl)
      if (!row) {
        // unreachable; satisfy TS
        return
      }

      if ((artifact.score?.supplyChain || 100) < row.score.supplyChain) {
        row.score.supplyChain = artifact.score?.supplyChain || 100
      }
      if ((artifact.score?.maintenance || 100) < row.score.maintenance) {
        row.score.maintenance = artifact.score?.maintenance || 100
      }
      if ((artifact.score?.quality || 100) < row.score.quality) {
        row.score.quality = artifact.score?.quality || 100
      }
      if ((artifact.score?.vulnerability || 100) < row.score.vulnerability) {
        row.score.vulnerability = artifact.score?.vulnerability || 100
      }
      if ((artifact.score?.license || 100) < row.score.license) {
        row.score.license = artifact.score?.license || 100
      }

      artifact.alerts?.forEach(({ severity, type }) => {
        row.alerts.set(`${type}:${severity}`, {
          type: (type as string) ?? 'unknown',
          severity: (severity as string) ?? 'none',
        })
      })
    } else {
      const alerts = new Map()
      artifact.alerts?.forEach(({ severity, type }) => {
        alerts.set(`${type}:${severity}`, {
          type: (type as string) ?? 'unknown',
          severity: (severity as string) ?? 'none',
        })
      })

      rows.set(purl, {
        ecosystem: artifact.type,
        namespace: artifact.namespace || '',
        name: artifact.name!,
        version: artifact.version || '',
        score: {
          supplyChain: artifact.score?.supplyChain || 100,
          maintenance: artifact.score?.maintenance || 100,
          quality: artifact.score?.quality || 100,
          vulnerability: artifact.score?.vulnerability || 100,
          license: artifact.score?.license || 100,
        },
        alerts,
      })
    }
  })

  return { rows, missing }
}

export function generateMarkdownReport(
  artifacts: Map<string, DedupedArtifact>,
  missing: string[],
): string {
  const blocks: string[] = []
  const dupes: Set<string> = new Set()
  artifacts.forEach(artifact => {
    const block = '## ' + formatReportCard(artifact, false)
    if (dupes.has(block)) {
      return
    }
    dupes.add(block)
    blocks.push(block)
  })

  return `
# Shallow Package Report

This report contains the response for requesting data on some package url(s).

Please note: The listed scores are ONLY for the package itself. It does NOT
             reflect the scores of any dependencies, transitive or otherwise.

${missing.length ? `\n## Missing response\n\nAt least one package had no response or the purl was not canonical:\n\n${missing.map(purl => '- ' + purl + '\n').join('')}` : ''}

${blocks.join('\n\n\n')}
    `.trim()
}

export function generateTextReport(
  artifacts: Map<string, DedupedArtifact>,
  missing: string[],
): string {
  const arr: string[] = []

  arr.push('\n' + colors.bold('Shallow Package Score') + '\n')
  arr.push(
    'Please note: The listed scores are ONLY for the package itself. It does NOT\n' +
      '             reflect the scores of any dependencies, transitive or otherwise.',
  )

  if (missing.length) {
    arr.push(
      `\nAt least one package had no response or the purl was not canonical:\n${missing.map(purl => '\n- ' + colors.bold(purl)).join('')}`,
    )
  }

  const dupes: Set<string> = new Set() // Omit dupes when output is identical
  artifacts.forEach(artifact => {
    const block = formatReportCard(artifact, true)
    if (dupes.has(block)) {
      return
    }
    dupes.add(block)
    arr.push('\n')
    arr.push(block)
  })
  arr.push('')

  return arr.join('\n')
}
