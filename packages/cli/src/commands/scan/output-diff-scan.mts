import { promises as fs } from 'node:fs'
import util from 'node:util'

import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SOCKET_WEBSITE_URL } from '../../constants/socket.mts'
import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'
import { fileLink } from '../../util/terminal/link.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'
const logger = getDefaultLogger()

export async function handleJson(
  data: CResult<SocketSdkSuccessResult<'getDiffScanById'>['data']>,
  file: string,
  dashboardMessage: string,
) {
  const json = serializeResultJson(data)

  if (file && file !== '-') {
    logger.log(`Writing json to \`${file}\``)
    try {
      await fs.writeFile(file, json, 'utf8')
      logger.success(`Data successfully written to \`${fileLink(file)}\``)
    } catch (e) {
      logger.fail(`Writing to \`${file}\` failed…`)
      logger.error(e)
      process.exitCode = 1
    }
    logger.info(dashboardMessage)
  } else {
    // only .log goes to stdout
    logger.error('')
    logger.info(' Diff scan result: ')
    logger.error('')
    logger.log(json)
    logger.info(dashboardMessage)
  }
}

export async function handleMarkdown(
  data: SocketSdkSuccessResult<'getDiffScanById'>['data'],
) {
  const SOCKET_SBOM_URL_PREFIX = `${SOCKET_WEBSITE_URL}/dashboard/org/SocketDev/sbom/`

  const diffScan = data.diff_scan
  const beforeScan = diffScan.before_full_scan
  const afterScan = diffScan.after_full_scan

  logger.log(mdHeader('Scan diff result'))
  logger.log('')
  logger.log('This Socket.dev report shows the changes between two scans:')
  logger.log(`- [${beforeScan.id}](${SOCKET_SBOM_URL_PREFIX}${beforeScan.id})`)
  logger.log(`- [${afterScan.id}](${SOCKET_SBOM_URL_PREFIX}${afterScan.id})`)
  logger.log('')
  logger.log(
    `You can [view this report in your dashboard](${diffScan.html_url})`,
  )
  logger.log('')
  logger.log(mdHeader('Changes', 2))
  logger.log('')
  logger.log(`- Added packages: ${diffScan.artifacts.added.length}`)

  if (diffScan.artifacts.added.length > 0) {
    const addedHead = diffScan.artifacts.added.slice(0, 10)
    for (let i = 0, { length } = addedHead; i < length; i += 1) {
      const artifact = addedHead[i]!
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    }
    if (diffScan.artifacts.added.length > 10) {
      logger.log(`  … and ${diffScan.artifacts.added.length - 10} more`)
    }
  }

  logger.log(`- Removed packages: ${diffScan.artifacts.removed.length}`)
  if (diffScan.artifacts.removed.length > 0) {
    const removedHead = diffScan.artifacts.removed.slice(0, 10)
    for (let i = 0, { length } = removedHead; i < length; i += 1) {
      const artifact = removedHead[i]!
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    }
    if (diffScan.artifacts.removed.length > 10) {
      logger.log(`  … and ${diffScan.artifacts.removed.length - 10} more`)
    }
  }

  logger.log(`- Replaced packages: ${diffScan.artifacts.replaced.length}`)
  if (diffScan.artifacts.replaced.length > 0) {
    const replacedHead = diffScan.artifacts.replaced.slice(0, 10)
    for (let i = 0, { length } = replacedHead; i < length; i += 1) {
      const artifact = replacedHead[i]!
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    }
    if (diffScan.artifacts.replaced.length > 10) {
      logger.log(`  … and ${diffScan.artifacts.replaced.length - 10} more`)
    }
  }

  logger.log(`- Updated packages: ${diffScan.artifacts.updated.length}`)
  if (diffScan.artifacts.updated.length > 0) {
    const updatedHead = diffScan.artifacts.updated.slice(0, 10)
    for (let i = 0, { length } = updatedHead; i < length; i += 1) {
      const artifact = updatedHead[i]!
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    }
    if (diffScan.artifacts.updated.length > 10) {
      logger.log(`  … and ${diffScan.artifacts.updated.length - 10} more`)
    }
  }

  const unchanged = diffScan.artifacts.unchanged ?? []
  logger.log(`- Unchanged packages: ${unchanged.length}`)
  if (unchanged.length > 0) {
    const firstUpToTen = unchanged.slice(0, 10)
    for (let i = 0, { length } = firstUpToTen; i < length; i += 1) {
      const artifact = firstUpToTen[i]!
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    }
    if (unchanged.length > 10) {
      logger.log(`  … and ${unchanged.length - 10} more`)
    }
  }

  logger.log('')
  logger.log(`## Scan ${beforeScan.id}`)
  logger.log('')
  logger.log(
    'This Scan was considered to be the "base" / "from" / "before" Scan.',
  )
  logger.log('')
  for (const { 0: key, 1: value } of Object.entries(beforeScan)) {
    if (key === 'pull_request' && !value) {
      continue
    }
    if (!['id', 'organization_id', 'repository_id'].includes(key)) {
      logger.group(
        `- ${key === 'repository_slug' ? 'repo' : key === 'organization_slug' ? 'org' : key}: ${String(value)}`,
      )
      logger.groupEnd()
    }
  }

  logger.log('')
  logger.log(`## Scan ${afterScan.id}`)
  logger.log('')
  logger.log('This Scan was considered to be the "head" / "to" / "after" Scan.')
  logger.log('')
  for (const { 0: key, 1: value } of Object.entries(afterScan)) {
    if (key === 'pull_request' && !value) {
      continue
    }
    if (!['id', 'organization_id', 'repository_id'].includes(key)) {
      logger.group(
        `- ${key === 'repository_slug' ? 'repo' : key === 'organization_slug' ? 'org' : key}: ${String(value)}`,
      )
      logger.groupEnd()
    }
  }

  logger.log('')
}

export async function outputDiffScan(
  result: CResult<SocketSdkSuccessResult<'getDiffScanById'>['data']>,
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

  const dashboardUrl = result.data.diff_scan.html_url
  const dashboardMessage = dashboardUrl
    ? `\n View this diff scan in the Socket dashboard: ${colors.cyan(dashboardUrl)}`
    : ''

  // When forcing json, or dumping to file, serialize to string such that it
  // won't get truncated. The only way to dump the full raw JSON to stdout is
  // to use `--json --file -`, the dash is a standard notation for stdout
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
      depth: depth > 0 ? depth : undefined,
      colors: true,
      maxArrayLength: undefined,
    }),
  )
  logger.error('')
  logger.info(
    ' 📝 To display the detailed report in the terminal, use the --json flag. For a friendlier report, use the --markdown flag.',
  )
  logger.error('')
  logger.info(dashboardMessage)
}
