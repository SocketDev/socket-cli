import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mdTable } from '../../utils/markdown.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { PurlDataResponse } from './fetch-purl-deep-score.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputPurlScore(
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
    const {
      purl: requestedPurl,
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
    } = result.data

    logger.success(`Score report for "${requestedPurl}" ("${purl}"):\n`)
    logger.log('# Complete Package Score')
    logger.log('')
    if (dependencyCount) {
      logger.log(
        `This is a Socket report for the package *"${purl}"* and its *${dependencyCount}* direct/transitive dependencies.`,
      )
    } else {
      logger.log(
        `This is a Socket report for the package *"${purl}"*. It has *no dependencies*.`,
      )
    }
    logger.log('')
    if (dependencyCount) {
      logger.log(
        `It will show you the shallow score for just the package itself and a deep score for all the transitives combined. Additionally you can see which capabilities were found and the top alerts as well as a package that was responsible for it.`,
      )
    } else {
      logger.log(
        `It will show you the shallow score for the package itself, which capabilities were found, and its top alerts.`,
      )
      logger.log('')
      logger.log(
        'Since it has no dependencies, the shallow score is also the deep score.',
      )
    }
    logger.log('')
    if (dependencyCount) {
      // This doesn't make much sense if there are no dependencies. Better to omit it.
      logger.log(
        'The report should give you a good insight into the status of this package.',
      )
      logger.log('')
      logger.log('## Package itself')
      logger.log('')
      logger.log(
        'Here are results for the package itself (excluding data from dependencies).',
      )
    } else {
      logger.log('## Report')
      logger.log('')
      logger.log(
        'The report should give you a good insight into the status of this package.',
      )
    }
    logger.log('')
    logger.log('### Shallow Score')
    logger.log('')
    logger.log('This score is just for the package itself:')
    logger.log('')
    logger.log('- Overall: ' + selfScore.overall)
    logger.log('- Maintenance: ' + selfScore.maintenance)
    logger.log('- Quality: ' + selfScore.quality)
    logger.log('- Supply Chain: ' + selfScore.supplyChain)
    logger.log('- Vulnerability: ' + selfScore.vulnerability)
    logger.log('- License: ' + selfScore.license)
    logger.log('')
    logger.log('### Capabilities')
    logger.log('')
    if (selfCaps.length) {
      logger.log('These are the capabilities detected in the package itself:')
      logger.log('')
      selfCaps.forEach(cap => {
        logger.log(`- ${cap}`)
      })
    } else {
      logger.log('No capabilities were found in the package.')
    }
    logger.log('')
    logger.log('### Alerts for this package')
    logger.log('')
    if (selfAlerts.length) {
      if (dependencyCount) {
        logger.log('These are the alerts found for the package itself:')
      } else {
        logger.log('These are the alerts found for this package:')
      }
      logger.log('')
      logger.log(
        mdTable(selfAlerts, ['severity', 'name'], ['Severity', 'Alert Name']),
      )
    } else {
      logger.log('There are currently no alerts for this package.')
    }
    logger.log('')
    if (dependencyCount) {
      logger.log('## Transitive Package Results')
      logger.log('')
      logger.log(
        'Here are results for the package and its direct/transitive dependencies.',
      )
      logger.log('')
      logger.log('### Deep Score')
      logger.log('')
      logger.log(
        'This score represents the package and and its direct/transitive dependencies:',
      )
      logger.log(
        `The function used to calculate the values in aggregate is: *"${func}"*`,
      )
      logger.log('')
      logger.log('- Overall: ' + score.overall)
      logger.log('- Maintenance: ' + score.maintenance)
      logger.log('- Quality: ' + score.quality)
      logger.log('- Supply Chain: ' + score.supplyChain)
      logger.log('- Vulnerability: ' + score.vulnerability)
      logger.log('- License: ' + score.license)
      logger.log('')
      logger.log('### Capabilities')
      logger.log('')
      logger.log(
        'These are the packages with the lowest recorded score. If there is more than one with the lowest score, just one is shown here. This may help you figure out the source of low scores.',
      )
      logger.log('')
      logger.log('- Overall: ' + lowest.overall)
      logger.log('- Maintenance: ' + lowest.maintenance)
      logger.log('- Quality: ' + lowest.quality)
      logger.log('- Supply Chain: ' + lowest.supplyChain)
      logger.log('- Vulnerability: ' + lowest.vulnerability)
      logger.log('- License: ' + lowest.license)
      logger.log('')
      logger.log('### Capabilities')
      logger.log('')
      if (capabilities.length) {
        logger.log(
          'These are the capabilities detected in at least one package:',
        )
        logger.log('')
        capabilities.forEach(cap => {
          logger.log(`- ${cap}`)
        })
      } else {
        logger.log(
          'This package had no capabilities and neither did any of its direct/transitive dependencies.',
        )
      }
      logger.log('')
      logger.log('### Alerts')
      logger.log('')
      if (alerts.length) {
        logger.log('These are the alerts found:')
        logger.log('')

        logger.log(
          mdTable(
            alerts,
            ['severity', 'name', 'example'],
            ['Severity', 'Alert Name', 'Example package reporting it'],
          ),
        )
      } else {
        logger.log(
          'This package had no alerts and neither did any of its direct/transitive dependencies',
        )
      }
      logger.log('')
    }
    return
  }

  logger.log(
    `Score report for "${purl}" (use --json for raw and --markdown for formatted reports):`,
  )
  logger.log(result.data)
  logger.log('')
}
