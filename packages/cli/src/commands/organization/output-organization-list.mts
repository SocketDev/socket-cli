import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { failMsgWithBadge } from '../../util/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../util/output/markdown.mts'
import { serializeResultJson } from '../../util/output/result-json.mjs'
import { getVisibleTokenPrefix } from '../../util/socket/sdk.mjs'

import type {
  Organizations,
  OrganizationsCResult,
} from './fetch-organization-list.mts'
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
    outputOrganizationText(organizations, visibleTokenPrefix)
    return
  }
  outputOrganizationMarkdown(organizations, visibleTokenPrefix)
}

export function outputOrganizationMarkdown(
  organizations: Organizations,
  visibleTokenPrefix: string,
): void {
  let nameWidth = 4
  let idWidth = 2
  let planWidth = 4
  for (const organization of organizations) {
    nameWidth = Math.max(nameWidth, organization.name?.length ?? 0)
    idWidth = Math.max(idWidth, organization.id.length)
    planWidth = Math.max(planWidth, organization.plan.length)
  }
  logger.log(mdHeader('Organizations'))
  logger.log('')
  logger.log(
    `List of organizations associated with your API token, starting with: ${colors.italic(visibleTokenPrefix)}`,
  )
  logger.log('')
  logger.log(
    `| Name${' '.repeat(nameWidth - 4)} | ID${' '.repeat(idWidth - 2)} | Plan${' '.repeat(planWidth - 4)} |`,
  )
  logger.log(
    `| ${'-'.repeat(nameWidth)} | ${'-'.repeat(idWidth)} | ${'-'.repeat(planWidth)} |`,
  )
  for (const organization of organizations) {
    logger.log(
      `| ${(organization.name || '').padEnd(nameWidth, ' ')} | ${(organization.id || '').padEnd(idWidth, ' ')} | ${(organization.plan || '').padEnd(planWidth, ' ')} |`,
    )
  }
  logger.log(
    `| ${'-'.repeat(nameWidth)} | ${'-'.repeat(idWidth)} | ${'-'.repeat(planWidth)} |`,
  )
}

export function outputOrganizationText(
  organizations: Organizations,
  visibleTokenPrefix: string,
): void {
  logger.log(
    `List of organizations associated with your API token, starting with: ${colors.italic(visibleTokenPrefix)}`,
  )
  logger.log('')
  for (const organization of organizations) {
    logger.log(
      `- Name: ${colors.bold(organization.name ?? 'undefined')}, ID: ${colors.bold(organization.id)}, Plan: ${colors.bold(organization.plan)}`,
    )
  }
}
