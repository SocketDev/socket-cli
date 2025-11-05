import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib-internal/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import { getVisibleTokenPrefix } from '../../utils/socket/sdk.mjs'

import type { OrganizationsCResult } from './fetch-organization-list.mts'
import type { OutputKind } from '../../types.mts'
const logger = getDefaultLogger()

export async function outputOrganizationList(
  orgsCResult: OrganizationsCResult,
  outputKind: OutputKind = 'text',
): Promise<void> {
  if (!orgsCResult.ok) {
    process.exitCode = orgsCResult.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(orgsCResult))
    return
  }

  if (!orgsCResult.ok) {
    logger.fail(failMsgWithBadge(orgsCResult.message, orgsCResult.cause))
    return
  }

  const { organizations } = orgsCResult.data
  const visibleTokenPrefix = getVisibleTokenPrefix()

  if (outputKind !== 'markdown') {
    logger.log(
      `List of organizations associated with your API token, starting with: ${colors.italic(visibleTokenPrefix)}\n`,
    )
    // Just dump.
    for (const o of organizations) {
      logger.log(
        `- Name: ${colors.bold(o.name ?? 'undefined')}, ID: ${colors.bold(o.id)}, Plan: ${colors.bold(o.plan)}`,
      )
    }
    return
  }

  // | Syntax      | Description |
  // | ----------- | ----------- |
  // | Header      | Title       |
  // | Paragraph   | Text        |
  let mw1 = 4
  let mw2 = 2
  let mw3 = 4
  for (const o of organizations) {
    mw1 = Math.max(mw1, o.name?.length ?? 0)
    mw2 = Math.max(mw2, o.id.length)
    mw3 = Math.max(mw3, o.plan.length)
  }
  logger.log(`${mdHeader('Organizations')}\n`)
  logger.log(
    `List of organizations associated with your API token, starting with: ${colors.italic(visibleTokenPrefix)}\n`,
  )
  logger.log(
    `| Name${' '.repeat(mw1 - 4)} | ID${' '.repeat(mw2 - 2)} | Plan${' '.repeat(mw3 - 4)} |`,
  )
  logger.log(`| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} | ${'-'.repeat(mw3)} |`)
  for (const o of organizations) {
    logger.log(
      `| ${(o.name || '').padEnd(mw1, ' ')} | ${(o.id || '').padEnd(mw2, ' ')} | ${(o.plan || '').padEnd(mw3, ' ')} |`,
    )
  }
  logger.log(`| ${'-'.repeat(mw1)} | ${'-'.repeat(mw2)} | ${'-'.repeat(mw3)} |`)
}
