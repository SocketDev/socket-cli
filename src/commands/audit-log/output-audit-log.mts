/** @fileoverview Audit log output formatting for Socket CLI. Formats audit log events in JSON, markdown, or launches interactive TUI viewer with pagination and real-time updates. */

import { render } from 'ink'
import React from 'react'

import { logger } from '@socketsecurity/registry/lib/logger'

import { AuditLogApp } from './AuditLogApp.js'
import constants, {
  FLAG_JSON,
  OUTPUT_JSON,
  OUTPUT_MARKDOWN,
} from '../../constants.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mdTable } from '../../utils/markdown.mts'
import { msAtHome } from '../../utils/ms-at-home.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputAuditLog(
  result: CResult<SocketSdkSuccessResult<'getAuditLogEvents'>['data']>,
  {
    logType,
    orgSlug,
    outputKind,
    page,
    perPage,
  }: {
    logType: string
    outputKind: OutputKind
    orgSlug: string
    page: number
    perPage: number
  },
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === OUTPUT_JSON) {
    logger.log(
      await outputAsJson(result, {
        logType,
        orgSlug,
        page,
        perPage,
      }),
    )
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (outputKind === OUTPUT_MARKDOWN) {
    logger.log(
      await outputAsMarkdown(result.data, {
        logType,
        orgSlug,
        page,
        perPage,
      }),
    )
    return
  }

  await outputWithBlessed(result.data, orgSlug)
}

export async function outputAsJson(
  auditLogs: CResult<SocketSdkSuccessResult<'getAuditLogEvents'>['data']>,
  {
    logType,
    orgSlug,
    page,
    perPage,
  }: {
    logType: string
    orgSlug: string
    page: number
    perPage: number
  },
): Promise<string> {
  if (!auditLogs.ok) {
    return serializeResultJson(auditLogs)
  }

  return serializeResultJson({
    ok: true,
    data: {
      desc: 'Audit logs for given query',
      generated: constants.ENV['VITEST']
        ? constants.REDACTED
        : new Date().toISOString(),
      logType,
      nextPage: auditLogs.data.nextPage,
      org: orgSlug,
      page,
      perPage,
      logs: auditLogs.data.results.map(log => {
        // Note: The subset is pretty arbitrary
        const {
          created_at,
          event_id,
          ip_address,
          type,
          user_agent,
          user_email,
        } = log
        return {
          event_id,
          created_at,
          ip_address,
          type,
          user_agent,
          user_email,
        }
      }),
    },
  })
}

export async function outputAsMarkdown(
  auditLogs: SocketSdkSuccessResult<'getAuditLogEvents'>['data'],
  {
    logType,
    orgSlug,
    page,
    perPage,
  }: {
    orgSlug: string
    page: number
    perPage: number
    logType: string
  },
): Promise<string> {
  try {
    const table = mdTable<any>(auditLogs.results, [
      'event_id',
      'created_at',
      'type',
      'user_email',
      'ip_address',
      'user_agent',
    ])

    return `
# Socket Audit Logs

These are the Socket.dev audit logs as per requested query.
- org: ${orgSlug}
- type filter: ${logType || '(none)'}
- page: ${page}
- next page: ${auditLogs.nextPage}
- per page: ${perPage}
- generated: ${constants.ENV['VITEST'] ? constants.REDACTED : new Date().toISOString()}

${table}
`
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      `There was a problem converting the logs to Markdown, please try the \`${FLAG_JSON}\` flag`,
    )
    debugFn('error', 'Markdown conversion failed')
    debugDir('error', e)
    return 'Failed to generate the markdown report'
  }
}

async function outputWithBlessed(
  data: SocketSdkSuccessResult<'getAuditLogEvents'>['data'],
  orgSlug: string,
) {
  // Prepare data with formatted dates.
  const results = data.results.map(log => ({
    ...log,
    formatted_created_at: msAtHome(log.created_at ?? ''),
  }))

  // Render the Ink app directly in the current process.
  const { waitUntilExit } = render(
    React.createElement(AuditLogApp, {
      orgSlug,
      results,
    }),
  )

  await waitUntilExit()
}
