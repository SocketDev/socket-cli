import { logger } from '@socketsecurity/registry/lib/logger'

export async function outputPurlScore(
  purl: string,
  data: unknown,
  outputKind: 'json' | 'markdown' | 'text'
) {
  if (outputKind === 'json') {
    let json
    try {
      json = JSON.stringify(data, null, 2)
    } catch {
      console.error(
        'Failed to convert the server response to JSON... Please try again or reach out to customer support.'
      )
      process.exitCode = 1
      return
    }

    logger.error(`Score report for "${purl}":\n`)
    logger.log(json)
    logger.log('')
    return
  }

  if (outputKind === 'markdown') {
    const { alerts, func, score, worst } = data as {
      func: string
      score: {
        license: number
        maintenance: number
        overall: number
        quality: number
        supplyChain: number
        vulnerability: number
      }
      worst: {
        license: string
        maintenance: string
        overall: string
        quality: string
        supplyChain: string
        vulnerability: string
      }
      alerts: Array<{
        name: string
        severity: string
        category: string
      }>
    }

    logger.error(`Score report for "${purl}":\n`)
    logger.log('# Deep Package Score')
    logger.log('')
    logger.log(
      'This Socket report contains the response for requesting a deep package score for'
    )
    logger.log(
      `a package and any of its dependencies or transitive dependencies.`
    )
    logger.log('')
    logger.log(`The package is: ${purl}`)
    logger.log('')
    logger.log('## Score')
    logger.log('')
    logger.log('Please note:')
    logger.log(
      '    The listed scores reflect the scores from the requested package, its'
    )
    logger.log(
      '    dependencies, and any transitive dependencies. An aggregation function'
    )
    logger.log(
      '    computes the final score which is presented in this report.'
    )
    logger.log('')
    logger.log(`The aggregation function that was used is: "${func}"`)
    logger.log('')
    logger.log('- Overall: ' + score.overall)
    logger.log('- Maintenance: ' + score.maintenance)
    logger.log('- Quality: ' + score.quality)
    logger.log('- Supply Chain: ' + score.supplyChain)
    logger.log('- Vulnerability: ' + score.vulnerability)
    logger.log('- License: ' + score.license)
    logger.log('')
    logger.log('## Worst score examples')
    logger.log('')
    logger.log(
      'These are packages with the worst score in each category. Only one package is'
    )
    logger.log(
      'listed even if multiple have that lowest score. Each of these packages is the'
    )
    logger.log('package itself or a (transitive) dependency.')
    logger.log('')
    logger.log('- Overall: ' + worst.overall)
    logger.log('- Maintenance: ' + worst.maintenance)
    logger.log('- Quality: ' + worst.quality)
    logger.log('- Supply Chain: ' + worst.supplyChain)
    logger.log('- Vulnerability: ' + worst.vulnerability)
    logger.log('- License: ' + worst.license)
    logger.log('')
    logger.log('## Alerts')
    logger.log('')
    logger.log(
      'Here is a list of the alerts emitted by this package or any of its (transitive)'
    )
    logger.log(
      'dependencies in aggregate. Only the first 100 or shown, ordered by severity.'
    )
    logger.log('')
    alerts.forEach(({ name, severity }) => {
      logger.log(`- [${severity}] ${name}`)
    })
    logger.log('')
    return
  }

  logger.log(`Score report for "${purl}":`)
  logger.log(data)
  logger.log('')
}
