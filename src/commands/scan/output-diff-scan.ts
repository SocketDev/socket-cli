import fs from 'node:fs'
import util from 'node:util'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

const SOCKET_SBOM_URL_PREFIX =
  'https://socket.dev/dashboard/org/SocketDev/sbom/'

export async function outputDiffScan(
  result: SocketSdkReturnType<'GetOrgDiffScan'>['data'],
  {
    depth,
    file,
    outputKind
  }: {
    depth: number
    file: string
    outputKind: OutputKind
  }
): Promise<void> {
  const dashboardUrl = result.diff_report_url
  const dashboardMessage = dashboardUrl
    ? `\n View this diff scan in the Socket dashboard: ${colors.cyan(dashboardUrl)}`
    : ''

  // When forcing json, or dumping to file, serialize to string such that it
  // won't get truncated. The only way to dump the full raw JSON to stdout is
  // to use `--json --file -` (the dash is a standard notation for stdout)
  if (outputKind === 'json' || file) {
    let json
    try {
      json = JSON.stringify(result, null, 2)
    } catch (e) {
      process.exitCode = 1
      // Most likely caused by a circular reference (or OOM)
      logger.fail('There was a problem converting the data to JSON')
      logger.error(e)
      return
    }

    if (file && file !== '-') {
      logger.log(`Writing json to \`${file}\``)
      fs.writeFile(file, JSON.stringify(result, null, 2), err => {
        if (err) {
          logger.fail(`Writing to \`${file}\` failed...`)
          logger.error(err)
        } else {
          logger.log(`Data successfully written to \`${file}\``)
        }
        logger.error(dashboardMessage)
      })
    } else {
      // TODO: expose different method for writing to stderr when simply dodging stdout
      logger.error(`\n Diff scan result: \n`)
      logger.log(json)
      logger.error(dashboardMessage)
    }

    return
  }

  if (outputKind === 'markdown') {
    logger.log('# Scan diff result')
    logger.log('')
    logger.log('This Socket.dev report shows the changes between two scans:')
    logger.log(
      `- [${result.before.id}](${SOCKET_SBOM_URL_PREFIX}${result.before.id})`
    )
    logger.log(
      `- [${result.after.id}](${SOCKET_SBOM_URL_PREFIX}${result.after.id})`
    )
    logger.log('')
    logger.log(
      `You can [view this report in your dashboard](${result.diff_report_url})`
    )
    logger.log('')
    logger.log('## Changes')
    logger.log('')
    logger.log(
      `- directDependenciesChanged: ${result.directDependenciesChanged}`
    )
    logger.log(`- Added packages: ${result.artifacts.added.length}`)
    if (result.artifacts.added.length > 0) {
      result.artifacts.added.slice(0, 10).forEach(artifact => {
        logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
      })
      if (result.artifacts.added.length > 10) {
        logger.log(`  ... and ${result.artifacts.added.length - 10} more`)
      }
    }
    logger.log(`- Removed packages: ${result.artifacts.removed.length}`)
    if (result.artifacts.removed.length > 0) {
      result.artifacts.removed.slice(0, 10).forEach(artifact => {
        logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
      })
      if (result.artifacts.removed.length > 10) {
        logger.log(`  ... and ${result.artifacts.removed.length - 10} more`)
      }
    }
    logger.log(`- Replaced packages: ${result.artifacts.replaced.length}`)
    if (result.artifacts.replaced.length > 0) {
      result.artifacts.replaced.slice(0, 10).forEach(artifact => {
        logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
      })
      if (result.artifacts.replaced.length > 10) {
        logger.log(`  ... and ${result.artifacts.replaced.length - 10} more`)
      }
    }
    logger.log(`- Updated packages: ${result.artifacts.updated.length}`)
    if (result.artifacts.updated.length > 0) {
      result.artifacts.updated.slice(0, 10).forEach(artifact => {
        logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
      })
      if (result.artifacts.updated.length > 10) {
        logger.log(`  ... and ${result.artifacts.updated.length - 10} more`)
      }
    }
    logger.log(`- Unchanged packages: ${result.artifacts.unchanged.length}`)
    if (result.artifacts.unchanged.length > 0) {
      result.artifacts.unchanged.slice(0, 10).forEach(artifact => {
        logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
      })
      if (result.artifacts.unchanged.length > 10) {
        logger.log(`  ... and ${result.artifacts.unchanged.length - 10} more`)
      }
    }
    logger.log('')
    logger.log(`## Scan ${result.before.id}`)
    logger.log('')
    logger.log(
      'This Scan was considered to be the "base" / "from" / "before" Scan.'
    )
    logger.log('')
    for (const [key, value] of Object.entries(result.before)) {
      if (key === 'pull_request' && !value) {
        continue
      }
      if (!['id', 'organization_id', 'repository_id'].includes(key)) {
        logger.group(
          `- ${key === 'repository_slug' ? 'repo' : key === 'organization_slug' ? 'org' : key}: ${value}`
        )
        logger.groupEnd()
      }
    }
    logger.log('')
    logger.log(`## Scan ${result.after.id}`)
    logger.log('')
    logger.log(
      'This Scan was considered to be the "head" / "to" / "after" Scan.'
    )
    logger.log('')
    for (const [key, value] of Object.entries(result.after)) {
      if (key === 'pull_request' && !value) {
        continue
      }
      if (!['id', 'organization_id', 'repository_id'].includes(key)) {
        logger.group(
          `- ${key === 'repository_slug' ? 'repo' : key === 'organization_slug' ? 'org' : key}: ${value}`
        )
        logger.groupEnd()
      }
    }
    logger.log('')

    return
  }

  // In this case neither the --json nor the --file flag was passed
  // Dump the JSON to CLI and let NodeJS deal with truncation

  logger.log('Diff scan result:')
  logger.log(
    util.inspect(result, {
      showHidden: false,
      depth: depth > 0 ? depth : null,
      colors: true,
      maxArrayLength: null
    })
  )
  logger.error(
    `\n 📝 To display the detailed report in the terminal, use the --json flag. For a friendlier report, use the --markdown flag.\n`
  )
  logger.log(dashboardMessage)
}
