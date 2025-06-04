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
) {
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

export function createMarkdownReport(data: PurlDataResponse) {
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

  const arr: string[] = []

  arr.push('# Complete Package Score')
  arr.push('')
  if (dependencyCount) {
    arr.push(
      `This is a Socket report for the package *"${purl}"* and its *${dependencyCount}* direct/transitive dependencies.`,
    )
  } else {
    arr.push(
      `This is a Socket report for the package *"${purl}"*. It has *no dependencies*.`,
    )
  }
  arr.push('')
  if (dependencyCount) {
    arr.push(
      `It will show you the shallow score for just the package itself and a deep score for all the transitives combined. Additionally you can see which capabilities were found and the top alerts as well as a package that was responsible for it.`,
    )
  } else {
    arr.push(
      `It will show you the shallow score for the package itself, which capabilities were found, and its top alerts.`,
    )
    arr.push('')
    arr.push(
      'Since it has no dependencies, the shallow score is also the deep score.',
    )
  }
  arr.push('')
  if (dependencyCount) {
    // This doesn't make much sense if there are no dependencies. Better to omit it.
    arr.push(
      'The report should give you a good insight into the status of this package.',
    )
    arr.push('')
    arr.push('## Package itself')
    arr.push('')
    arr.push(
      'Here are results for the package itself (excluding data from dependencies).',
    )
  } else {
    arr.push('## Report')
    arr.push('')
    arr.push(
      'The report should give you a good insight into the status of this package.',
    )
  }
  arr.push('')
  arr.push('### Shallow Score')
  arr.push('')
  arr.push('This score is just for the package itself:')
  arr.push('')
  arr.push('- Overall: ' + selfScore.overall)
  arr.push('- Maintenance: ' + selfScore.maintenance)
  arr.push('- Quality: ' + selfScore.quality)
  arr.push('- Supply Chain: ' + selfScore.supplyChain)
  arr.push('- Vulnerability: ' + selfScore.vulnerability)
  arr.push('- License: ' + selfScore.license)
  arr.push('')
  arr.push('### Capabilities')
  arr.push('')
  if (selfCaps.length) {
    arr.push('These are the capabilities detected in the package itself:')
    arr.push('')
    selfCaps.forEach(cap => {
      arr.push(`- ${cap}`)
    })
  } else {
    arr.push('No capabilities were found in the package.')
  }
  arr.push('')
  arr.push('### Alerts for this package')
  arr.push('')
  if (selfAlerts.length) {
    if (dependencyCount) {
      arr.push('These are the alerts found for the package itself:')
    } else {
      arr.push('These are the alerts found for this package:')
    }
    arr.push('')
    arr.push(
      mdTable(selfAlerts, ['severity', 'name'], ['Severity', 'Alert Name']),
    )
  } else {
    arr.push('There are currently no alerts for this package.')
  }
  arr.push('')
  if (dependencyCount) {
    arr.push('## Transitive Package Results')
    arr.push('')
    arr.push(
      'Here are results for the package and its direct/transitive dependencies.',
    )
    arr.push('')
    arr.push('### Deep Score')
    arr.push('')
    arr.push(
      'This score represents the package and and its direct/transitive dependencies:',
    )
    arr.push(
      `The function used to calculate the values in aggregate is: *"${func}"*`,
    )
    arr.push('')
    arr.push('- Overall: ' + score.overall)
    arr.push('- Maintenance: ' + score.maintenance)
    arr.push('- Quality: ' + score.quality)
    arr.push('- Supply Chain: ' + score.supplyChain)
    arr.push('- Vulnerability: ' + score.vulnerability)
    arr.push('- License: ' + score.license)
    arr.push('')
    arr.push('### Capabilities')
    arr.push('')
    arr.push(
      'These are the packages with the lowest recorded score. If there is more than one with the lowest score, just one is shown here. This may help you figure out the source of low scores.',
    )
    arr.push('')
    arr.push('- Overall: ' + lowest.overall)
    arr.push('- Maintenance: ' + lowest.maintenance)
    arr.push('- Quality: ' + lowest.quality)
    arr.push('- Supply Chain: ' + lowest.supplyChain)
    arr.push('- Vulnerability: ' + lowest.vulnerability)
    arr.push('- License: ' + lowest.license)
    arr.push('')
    arr.push('### Capabilities')
    arr.push('')
    if (capabilities.length) {
      arr.push('These are the capabilities detected in at least one package:')
      arr.push('')
      capabilities.forEach(cap => {
        arr.push(`- ${cap}`)
      })
    } else {
      arr.push(
        'This package had no capabilities and neither did any of its direct/transitive dependencies.',
      )
    }
    arr.push('')
    arr.push('### Alerts')
    arr.push('')
    if (alerts.length) {
      arr.push('These are the alerts found:')
      arr.push('')

      arr.push(
        mdTable(
          alerts,
          ['severity', 'name', 'example'],
          ['Severity', 'Alert Name', 'Example package reporting it'],
        ),
      )
    } else {
      arr.push(
        'This package had no alerts and neither did any of its direct/transitive dependencies',
      )
    }
    arr.push('')

    return arr.join('\n')
  }
}
