import fs from 'node:fs'
import util from 'node:util'

import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { SOCKET_WEBSITE_URL } from '../../constants/socket.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import { fileLink } from '../../utils/terminal/link.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

type DiffScanArtifact =
  SocketSdkSuccessResult<'GetOrgDiffScan'>['data']['artifacts']['added'][number]

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
      getDefaultLogger().log(serializeResultJson(result))
      return
    }
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
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

  getDefaultLogger().log('Diff scan result:')
  getDefaultLogger().log(
    util.inspect(result.data, {
      showHidden: false,
      depth: depth > 0 ? depth : null,
      colors: true,
      maxArrayLength: null,
    }),
  )
  getDefaultLogger().info(
    '\n 📝 To display the detailed report in the terminal, use the --json flag. For a friendlier report, use the --markdown flag.\n',
  )
  getDefaultLogger().info(dashboardMessage)
}

async function handleJson(
  data: CResult<SocketSdkSuccessResult<'GetOrgDiffScan'>['data']>,
  file: string,
  dashboardMessage: string,
) {
  const json = serializeResultJson(data)

  if (file && file !== '-') {
    getDefaultLogger().log(`Writing json to \`${file}\``)
    fs.writeFile(file, json, err => {
      if (err) {
        getDefaultLogger().fail(`Writing to \`${file}\` failed...`)
        getDefaultLogger().error(err)
      } else {
        getDefaultLogger().success(
          `Data successfully written to \`${fileLink(file)}\``,
        )
      }
      getDefaultLogger().error(dashboardMessage)
    })
  } else {
    // only .log goes to stdout
    getDefaultLogger().info('\n Diff scan result: \n')
    getDefaultLogger().log(json)
    getDefaultLogger().info(dashboardMessage)
  }
}

async function handleMarkdown(
  data: SocketSdkSuccessResult<'GetOrgDiffScan'>['data'],
) {
  const SOCKET_SBOM_URL_PREFIX = `${SOCKET_WEBSITE_URL}/dashboard/org/SocketDev/sbom/`

  getDefaultLogger().log(mdHeader('Scan diff result'))
  getDefaultLogger().log('')
  getDefaultLogger().log(
    'This Socket.dev report shows the changes between two scans:',
  )
  getDefaultLogger().log(
    `- [${data.before.id}](${SOCKET_SBOM_URL_PREFIX}${data.before.id})`,
  )
  getDefaultLogger().log(
    `- [${data.after.id}](${SOCKET_SBOM_URL_PREFIX}${data.after.id})`,
  )
  getDefaultLogger().log('')
  getDefaultLogger().log(
    `You can [view this report in your dashboard](${data.diff_report_url})`,
  )
  getDefaultLogger().log('')
  getDefaultLogger().log(mdHeader('Changes', 2))
  getDefaultLogger().log('')
  getDefaultLogger().log(
    `- directDependenciesChanged: ${data.directDependenciesChanged}`,
  )
  getDefaultLogger().log(`- Added packages: ${data.artifacts.added.length}`)

  if (data.artifacts.added.length > 0) {
    data.artifacts.added.slice(0, 10).forEach((artifact: DiffScanArtifact) => {
      getDefaultLogger().log(
        `  - ${artifact.type} ${artifact.name}@${artifact.version}`,
      )
    })
    if (data.artifacts.added.length > 10) {
      getDefaultLogger().log(`  … and ${data.artifacts.added.length - 10} more`)
    }
  }

  getDefaultLogger().log(`- Removed packages: ${data.artifacts.removed.length}`)
  if (data.artifacts.removed.length > 0) {
    data.artifacts.removed
      .slice(0, 10)
      .forEach((artifact: DiffScanArtifact) => {
        getDefaultLogger().log(
          `  - ${artifact.type} ${artifact.name}@${artifact.version}`,
        )
      })
    if (data.artifacts.removed.length > 10) {
      getDefaultLogger().log(
        `  … and ${data.artifacts.removed.length - 10} more`,
      )
    }
  }

  getDefaultLogger().log(
    `- Replaced packages: ${data.artifacts.replaced.length}`,
  )
  if (data.artifacts.replaced.length > 0) {
    data.artifacts.replaced
      .slice(0, 10)
      .forEach((artifact: DiffScanArtifact) => {
        getDefaultLogger().log(
          `  - ${artifact.type} ${artifact.name}@${artifact.version}`,
        )
      })
    if (data.artifacts.replaced.length > 10) {
      getDefaultLogger().log(
        `  … and ${data.artifacts.replaced.length - 10} more`,
      )
    }
  }

  getDefaultLogger().log(`- Updated packages: ${data.artifacts.updated.length}`)
  if (data.artifacts.updated.length > 0) {
    data.artifacts.updated
      .slice(0, 10)
      .forEach((artifact: DiffScanArtifact) => {
        getDefaultLogger().log(
          `  - ${artifact.type} ${artifact.name}@${artifact.version}`,
        )
      })
    if (data.artifacts.updated.length > 10) {
      getDefaultLogger().log(
        `  … and ${data.artifacts.updated.length - 10} more`,
      )
    }
  }

  const unchanged = data.artifacts.unchanged ?? []
  getDefaultLogger().log(`- Unchanged packages: ${unchanged.length}`)
  if (unchanged.length > 0) {
    const firstUpToTen = unchanged.slice(0, 10)
    for (const artifact of firstUpToTen) {
      getDefaultLogger().log(
        `  - ${artifact.type} ${artifact.name}@${artifact.version}`,
      )
    }
    if (unchanged.length > 10) {
      getDefaultLogger().log(`  … and ${unchanged.length - 10} more`)
    }
  }

  getDefaultLogger().log('')
  getDefaultLogger().log(`## Scan ${data.before.id}`)
  getDefaultLogger().log('')
  getDefaultLogger().log(
    'This Scan was considered to be the "base" / "from" / "before" Scan.',
  )
  getDefaultLogger().log('')
  for (const { 0: key, 1: value } of Object.entries(data.before)) {
    if (key === 'pull_request' && !value) {
      continue
    }
    if (!['id', 'organization_id', 'repository_id'].includes(key)) {
      getDefaultLogger().group(
        `- ${key === 'repository_slug' ? 'repo' : key === 'organization_slug' ? 'org' : key}: ${value}`,
      )
      getDefaultLogger().groupEnd()
    }
  }

  getDefaultLogger().log('')
  getDefaultLogger().log(`## Scan ${data.after.id}`)
  getDefaultLogger().log('')
  getDefaultLogger().log(
    'This Scan was considered to be the "head" / "to" / "after" Scan.',
  )
  getDefaultLogger().log('')
  for (const { 0: key, 1: value } of Object.entries(data.after)) {
    if (key === 'pull_request' && !value) {
      continue
    }
    if (!['id', 'organization_id', 'repository_id'].includes(key)) {
      getDefaultLogger().group(
        `- ${key === 'repository_slug' ? 'repo' : key === 'organization_slug' ? 'org' : key}: ${value}`,
      )
      getDefaultLogger().groupEnd()
    }
  }

  getDefaultLogger().log('')
}
