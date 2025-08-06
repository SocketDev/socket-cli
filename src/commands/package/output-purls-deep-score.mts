import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mdTable } from '../../utils/markdown.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { PurlDataResponse } from './fetch-purl-deep-score.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputPurlsDeepScore(
  purl: string,
  result: CResult<PurlDataResponse>,
  outputKind: OutputKind,
): Promise<void> {
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

  if (outputKind === 'markdown') {
    const md = createMarkdownReport(result.data)
    logger.success(`Score report for "${result.data.purl}" ("${purl}"):\n`)
    logger.log(md)
    return
  }

  logger.log(
    `Score report for "${purl}" (use --json for raw and --markdown for formatted reports):`,
  )
  logger.log(result.data)
  logger.log('')
}

export function createMarkdownReport(data: PurlDataResponse): string {
  const {
    self: {
      alerts: selfAlerts,
      capabilities: selfCaps,
      purl,
      score: selfScore,
    },
    transitively: {
      alerts,
      capabilities,
      dependencyCount,
      func,
      lowest,
      score,
    },
  } = data

  const o: string[] = ['# Complete Package Score', '']
  if (dependencyCount) {
    o.push(
      `This is a Socket report for the package *"${purl}"* and its *${dependencyCount}* direct/transitive dependencies.`,
    )
  } else {
    o.push(
      `This is a Socket report for the package *"${purl}"*. It has *no dependencies*.`,
    )
  }
  o.push('')
  if (dependencyCount) {
    o.push(
      `It will show you the shallow score for just the package itself and a deep score for all the transitives combined. Additionally you can see which capabilities were found and the top alerts as well as a package that was responsible for it.`,
    )
  } else {
    o.push(
      `It will show you the shallow score for the package itself, which capabilities were found, and its top alerts.`,
    )
    o.push('')
    o.push(
      'Since it has no dependencies, the shallow score is also the deep score.',
    )
  }
  o.push('')
  if (dependencyCount) {
    // This doesn't make much sense if there are no dependencies. Better to omit it.
    o.push(
      'The report should give you a good insight into the status of this package.',
    )
    o.push('')
    o.push('## Package itself')
    o.push('')
    o.push(
      'Here are results for the package itself (excluding data from dependencies).',
    )
  } else {
    o.push('## Report')
    o.push('')
    o.push(
      'The report should give you a good insight into the status of this package.',
    )
  }
  o.push('')
  o.push('### Shallow Score')
  o.push('')
  o.push('This score is just for the package itself:')
  o.push('')
  o.push(`- Overall: ${selfScore.overall}`)
  o.push(`- Maintenance: ${selfScore.maintenance}`)
  o.push(`- Quality: ${selfScore.quality}`)
  o.push(`- Supply Chain: ${selfScore.supplyChain}`)
  o.push(`- Vulnerability: ${selfScore.vulnerability}`)
  o.push(`- License: ${selfScore.license}`)
  o.push('')
  o.push('### Capabilities')
  o.push('')
  if (selfCaps.length) {
    o.push('These are the capabilities detected in the package itself:')
    o.push('')
    for (const cap of selfCaps) {
      o.push(`- ${cap}`)
    }
  } else {
    o.push('No capabilities were found in the package.')
  }
  o.push('')
  o.push('### Alerts for this package')
  o.push('')
  if (selfAlerts.length) {
    if (dependencyCount) {
      o.push('These are the alerts found for the package itself:')
    } else {
      o.push('These are the alerts found for this package:')
    }
    o.push('')
    o.push(
      mdTable(selfAlerts, ['severity', 'name'], ['Severity', 'Alert Name']),
    )
  } else {
    o.push('There are currently no alerts for this package.')
  }
  o.push('')
  if (dependencyCount) {
    o.push('## Transitive Package Results')
    o.push('')
    o.push(
      'Here are results for the package and its direct/transitive dependencies.',
    )
    o.push('')
    o.push('### Deep Score')
    o.push('')
    o.push(
      'This score represents the package and and its direct/transitive dependencies:',
    )
    o.push(
      `The function used to calculate the values in aggregate is: *"${func}"*`,
    )
    o.push('')
    o.push(`- Overall: ${score.overall}`)
    o.push(`- Maintenance: ${score.maintenance}`)
    o.push(`- Quality: ${score.quality}`)
    o.push(`- Supply Chain: ${score.supplyChain}`)
    o.push(`- Vulnerability: ${score.vulnerability}`)
    o.push(`- License: ${score.license}`)
    o.push('')
    o.push('### Capabilities')
    o.push('')
    o.push(
      'These are the packages with the lowest recorded score. If there is more than one with the lowest score, just one is shown here. This may help you figure out the source of low scores.',
    )
    o.push('')
    o.push(`- Overall: ${lowest.overall}`)
    o.push(`- Maintenance: ${lowest.maintenance}`)
    o.push(`- Quality: ${lowest.quality}`)
    o.push(`- Supply Chain: ${lowest.supplyChain}`)
    o.push(`- Vulnerability: ${lowest.vulnerability}`)
    o.push(`- License: ${lowest.license}`)
    o.push('')
    o.push('### Capabilities')
    o.push('')
    if (capabilities.length) {
      o.push('These are the capabilities detected in at least one package:')
      o.push('')
      for (const cap of capabilities) {
        o.push(`- ${cap}`)
      }
    } else {
      o.push(
        'This package had no capabilities and neither did any of its direct/transitive dependencies.',
      )
    }
    o.push('')
    o.push('### Alerts')
    o.push('')
    if (alerts.length) {
      o.push('These are the alerts found:')
      o.push('')

      o.push(
        mdTable(
          alerts,
          ['severity', 'name', 'example'],
          ['Severity', 'Alert Name', 'Example package reporting it'],
        ),
      )
    } else {
      o.push(
        'This package had no alerts and neither did any of its direct/transitive dependencies',
      )
    }
    o.push('')
  }
  return o.join('\n')
}
