import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'
import type { components } from '@socketsecurity/sdk/types/api'

export function outputPurlsShallowScore(
  purls: string[],
  packageData: Array<components['schemas']['SocketArtifact']>,
  outputKind: OutputKind
): void {
  if (outputKind === 'json') {
    // In JSON simply return what the server responds with. Don't bother trying
    // to match the response with the requested packages/purls.
    logger.log(JSON.stringify(packageData, undefined, 2))
    return
  }

  // Make some effort to match the requested data with the response

  const set = new Set()
  packageData.forEach(data => {
    set.add('pkg:' + data.type + '/' + data.name + '@' + data.version)
    set.add('pkg:' + data.type + '/' + data.name)
  })
  const missing = purls.filter(purl => {
    if (set.has(purl)) {
      return false
    }
    if (purl.endsWith('@latest') && set.has(purl.slice(0, -'@latest'.length))) {
      return false
    }
    return true // not found
  })

  if (outputKind === 'markdown') {
    logger.log(
      `
# Shallow Package Report

This report contains the response for requesting data on some package url(s).

Please note: The listed scores are ONLY for the package itself. It does NOT
             reflect the scores of any dependencies, transitive or otherwise.

${missing.length ? `\n## Missing response\n\nAt least one package had no response or the purl was not canonical:\n\n${missing.map(purl => '- ' + purl + '\n').join('')}` : ''}

${packageData.map(data => '## ' + formatReportCard(data, false)).join('\n\n\n')}
    `.trim()
    )
    return
  }

  logger.log('\n' + colors.bold('Shallow Package Score') + '\n')
  logger.log(
    'Please note: The listed scores are ONLY for the package itself. It does NOT\n' +
      '             reflect the scores of any dependencies, transitive or otherwise.'
  )

  if (missing.length) {
    logger.log(
      `\nAt least one package had no response or the purl was not canonical:\n${missing.map(purl => '\n- ' + colors.bold(purl)).join('')}`
    )
  }

  packageData.forEach(data => {
    logger.log('\n')
    logger.log(formatReportCard(data, true))
  })
  logger.log('')
}

function formatReportCard(
  data: components['schemas']['SocketArtifact'],
  color: boolean
): string {
  const scoreResult = {
    'Supply Chain Risk': Math.floor((data.score?.supplyChain ?? 0) * 100),
    Maintenance: Math.floor((data.score?.maintenance ?? 0) * 100),
    Quality: Math.floor((data.score?.quality ?? 0) * 100),
    Vulnerabilities: Math.floor((data.score?.vulnerability ?? 0) * 100),
    License: Math.floor((data.score?.license ?? 0) * 100)
  }
  const alertString = getAlertString(data.alerts, !color)
  const purl = 'pkg:' + data.type + '/' + data.name + '@' + data.version

  return [
    'Package: ' + (color ? colors.bold(purl) : purl),
    '',
    ...Object.entries(scoreResult).map(
      score =>
        `- ${score[0]}:`.padEnd(20, ' ') +
        `  ${formatScore(score[1], !color, true)}`
    ),
    alertString
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
  alerts: Array<components['schemas']['SocketAlert']> | undefined,
  noColor = false
) {
  if (!alerts?.length) {
    return noColor ? `- Alerts: none!` : `- Alerts: ${colors.green('none')}!`
  }
  const bad = alerts
    .filter(alert => alert.severity !== 'low' && alert.severity !== 'middle')
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  const mid = alerts
    .filter(alert => alert.severity === 'middle')
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  const low = alerts
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
        low.map(alert => `[${alert.severity}] ` + alert.type).join(', ')
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
          colors.red(colors.dim(`[${alert.severity}] `) + alert.type)
        )
        .join(', '),
      mid
        .map(alert =>
          colors.yellow(colors.dim(`[${alert.severity}] `) + alert.type)
        )
        .join(', '),
      low
        .map(alert => colors.dim(`[${alert.severity}] `) + alert.type)
        .join(', ')
    ]
      .filter(Boolean)
      .join(', ')
  )
}
