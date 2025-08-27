import fs from 'node:fs'
import util from 'node:util'

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

const { SOCKET_WEBSITE_URL } = constants

const SOCKET_SBOM_URL_PREFIX = `${SOCKET_WEBSITE_URL}/dashboard/org/SocketDev/sbom/`

export async function outputDiffScan(
  result: CResult<SocketSdkSuccessResult<'GetOrgDiffScan'>['data']>,
  {
    depth,
    file,
    outputKind,
  }: {
    depth: number
    file: string
    outputKind: OutputKind
  },
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    if (outputKind === 'json') {
      logger.log(serializeResultJson(result))
      return
    }
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const dashboardUrl = result.data.diff_report_url
  const dashboardMessage = dashboardUrl
    ? `\n View this diff scan in the Socket dashboard: ${colors.cyan(dashboardUrl)}`
    : ''

  // When forcing json, or dumping to file, serialize to string such that it
  // won't get truncated. The only way to dump the full raw JSON to stdout is
  // to use `--json --file -` (the dash is a standard notation for stdout)
  if (outputKind === 'json' || file) {
    await handleJson(result, file, dashboardMessage)
    return
  }

  if (outputKind === 'markdown') {
    await handleMarkdown(result.data)
    return
  }

  // In this case neither the --json nor the --file flag was passed
  // Dump the JSON to CLI and let NodeJS deal with truncation

  logger.log('Diff scan result:')
  logger.log(
    util.inspect(result.data, {
      showHidden: false,
      depth: depth > 0 ? depth : null,
      colors: true,
      maxArrayLength: null,
    }),
  )
  logger.info(
    `\n 📝 To display the detailed report in the terminal, use the --json flag. For a friendlier report, use the --markdown flag.\n`,
  )
  logger.info(dashboardMessage)
}

async function handleJson(
  data: CResult<SocketSdkSuccessResult<'GetOrgDiffScan'>['data']>,
  file: string,
  dashboardMessage: string,
) {
  const json = serializeResultJson(data)

  if (file && file !== '-') {
    logger.log(`Writing json to \`${file}\``)
    fs.writeFile(file, json, err => {
      if (err) {
        logger.fail(`Writing to \`${file}\` failed...`)
        logger.error(err)
      } else {
        logger.success(`Data successfully written to \`${file}\``)
      }
      logger.error(dashboardMessage)
    })
  } else {
    // only .log goes to stdout
    logger.info(`\n Diff scan result: \n`)
    logger.log(json)
    logger.info(dashboardMessage)
  }
}

async function handleMarkdown(
  data: SocketSdkSuccessResult<'GetOrgDiffScan'>['data'],
) {
  logger.log('# Scan diff result')
  logger.log('')
  logger.log('This Socket.dev report shows the changes between two scans:')
  logger.log(
    `- [${data.before.id}](${SOCKET_SBOM_URL_PREFIX}${data.before.id})`,
  )
  logger.log(`- [${data.after.id}](${SOCKET_SBOM_URL_PREFIX}${data.after.id})`)
  logger.log('')
  logger.log(
    `You can [view this report in your dashboard](${data.diff_report_url})`,
  )
  logger.log('')
  logger.log('## Changes')
  logger.log('')
  logger.log(`- directDependenciesChanged: ${data.directDependenciesChanged}`)
  logger.log(`- Added packages: ${data.artifacts.added.length}`)

  if (data.artifacts.added.length > 0) {
    data.artifacts.added.slice(0, 10).forEach(artifact => {
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    })
    if (data.artifacts.added.length > 10) {
      logger.log(`  ... and ${data.artifacts.added.length - 10} more`)
    }
  }

  logger.log(`- Removed packages: ${data.artifacts.removed.length}`)
  if (data.artifacts.removed.length > 0) {
    data.artifacts.removed.slice(0, 10).forEach(artifact => {
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    })
    if (data.artifacts.removed.length > 10) {
      logger.log(`  ... and ${data.artifacts.removed.length - 10} more`)
    }
  }

  logger.log(`- Replaced packages: ${data.artifacts.replaced.length}`)
  if (data.artifacts.replaced.length > 0) {
    data.artifacts.replaced.slice(0, 10).forEach(artifact => {
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    })
    if (data.artifacts.replaced.length > 10) {
      logger.log(`  ... and ${data.artifacts.replaced.length - 10} more`)
    }
  }

  logger.log(`- Updated packages: ${data.artifacts.updated.length}`)
  if (data.artifacts.updated.length > 0) {
    data.artifacts.updated.slice(0, 10).forEach(artifact => {
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    })
    if (data.artifacts.updated.length > 10) {
      logger.log(`  ... and ${data.artifacts.updated.length - 10} more`)
    }
  }

  const unchanged = data.artifacts.unchanged ?? []
  logger.log(`- Unchanged packages: ${unchanged.length}`)
  if (unchanged.length > 0) {
    const firstUpToTen = unchanged.slice(0, 10)
    for (const artifact of firstUpToTen) {
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    }
    if (unchanged.length > 10) {
      logger.log(`  ... and ${unchanged.length - 10} more`)
    }
  }

  logger.log('')
  logger.log(`## Scan ${data.before.id}`)
  logger.log('')
  logger.log(
    'This Scan was considered to be the "base" / "from" / "before" Scan.',
  )
  logger.log('')
  for (const [key, value] of Object.entries(data.before)) {
    if (key === 'pull_request' && !value) {
      continue
    }
    if (!['id', 'organization_id', 'repository_id'].includes(key)) {
      logger.group(
        `- ${key === 'repository_slug' ? 'repo' : key === 'organization_slug' ? 'org' : key}: ${value}`,
      )
      logger.groupEnd()
    }
  }

  logger.log('')
  logger.log(`## Scan ${data.after.id}`)
  logger.log('')
  logger.log('This Scan was considered to be the "head" / "to" / "after" Scan.')
  logger.log('')
  for (const [key, value] of Object.entries(data.after)) {
    if (key === 'pull_request' && !value) {
      continue
    }
    if (!['id', 'organization_id', 'repository_id'].includes(key)) {
      logger.group(
        `- ${key === 'repository_slug' ? 'repo' : key === 'organization_slug' ? 'org' : key}: ${value}`,
      )
      logger.groupEnd()
    }
  }

  logger.log('')
}
