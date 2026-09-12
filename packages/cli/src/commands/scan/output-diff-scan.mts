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
  outputDiffArtifactSummary('Added', diffScan.artifacts.added)
  outputDiffArtifactSummary('Removed', diffScan.artifacts.removed)
  outputDiffArtifactSummary('Replaced', diffScan.artifacts.replaced)
  outputDiffArtifactSummary('Updated', diffScan.artifacts.updated)
  outputDiffArtifactSummary('Unchanged', diffScan.artifacts.unchanged ?? [])

  logger.log('')
  logger.log(`## Scan ${beforeScan.id}`)
  logger.log('')
  logger.log(
    'This Scan was considered to be the "base" / "from" / "before" Scan.',
  )
  logger.log('')
  outputDiffScanMetadata(beforeScan)

  logger.log('')
  logger.log(`## Scan ${afterScan.id}`)
  logger.log('')
  logger.log('This Scan was considered to be the "head" / "to" / "after" Scan.')
  logger.log('')
  outputDiffScanMetadata(afterScan)

  logger.log('')
}

export function outputDiffArtifactSummary(
  label: string,
  artifacts: SocketSdkSuccessResult<'getDiffScanById'>['data']['diff_scan']['artifacts']['added'],
): void {
  logger.log(`- ${label} packages: ${artifacts.length}`)
  if (artifacts.length > 0) {
    const head = artifacts.slice(0, 10)
    for (let index = 0, { length } = head; index < length; index += 1) {
      const artifact = head[index]!
      logger.log(`  - ${artifact.type} ${artifact.name}@${artifact.version}`)
    }
    if (artifacts.length > 10) {
      logger.log(`  … and ${artifacts.length - 10} more`)
    }
  }
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
    ' To display the detailed report in the terminal, use the --json flag. For a friendlier report, use the --markdown flag.',
  )
  logger.error('')
  logger.info(dashboardMessage)
}

export function outputDiffScanMetadata(
  scan: SocketSdkSuccessResult<'getDiffScanById'>['data']['diff_scan']['before_full_scan'],
): void {
  for (const { 0: key, 1: value } of Object.entries(scan)) {
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
}
