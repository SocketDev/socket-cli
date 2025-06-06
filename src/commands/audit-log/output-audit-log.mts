import { createRequire } from 'node:module'

import { debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mdTable } from '../../utils/markdown.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { Widgets } from 'blessed'

const require = createRequire(import.meta.url)

const { REDACTED } = constants

export async function outputAuditLog(
  result: CResult<SocketSdkReturnType<'getAuditLogEvents'>['data']>,
  {
    logType,
    orgSlug,
    outputKind,
    page,
    perPage,
  }: {
    outputKind: OutputKind
    orgSlug: string
    page: number
    perPage: number
    logType: string
  },
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
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

  if (outputKind === 'markdown') {
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

  const filteredLogs = result.data.results
  const formattedOutput = filteredLogs.map(logs => [
    logs.event_id ?? '',
    logs.created_at ?? '',
    (logs.type || '').padEnd(30, ' '),
    logs.user_email ?? '',
    logs.ip_address ?? '',
    logs.user_agent ?? '',
  ])
  const headers = [
    'event id',
    '  created at',
    '  event type',
    '  user email',
    '  ip address',
    '  user agent',
  ]

  // Note: this temporarily takes over the terminal (just like `man` does).
  const ScreenWidget = require('blessed/lib/widgets/screen.js')
  // Lazily access constants.blessedOptions.
  const screen: Widgets.Screen = new ScreenWidget({
    ...constants.blessedOptions,
  })
  // Register these keys first so you can always exit, even when it gets stuck
  // If we don't do this and the code crashes, the user must hard-kill the
  // node process just to exit it. That's very bad UX.
  // eslint-disable-next-line n/no-process-exit
  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))

  const TableWidget = require('blessed-contrib/lib/widget/table.js')
  const table: any = new TableWidget({
    keys: 'true',
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'magenta',
    interactive: 'true',
    label: `Audit Logs for ${orgSlug}`,
    width: '100%',
    height: '70%', // Changed from 100% to 70%
    border: {
      type: 'line',
      fg: 'cyan',
    },
    columnWidth: [10, 30, 30, 25, 15, 200],
    // TODO: the truncation doesn't seem to work too well yet but when we add
    //       `pad` alignment fails, when we extend columnSpacing alignment fails
    columnSpacing: 1,
    truncate: '_',
  })

  // Create details box at the bottom
  const BoxWidget = require('blessed/lib/widgets/box.js')
  const detailsBox: Widgets.BoxElement = new BoxWidget({
    bottom: 0,
    height: '30%',
    width: '100%',
    border: {
      type: 'line',
      fg: 'cyan',
    },
    label: 'Details',
    content:
      'Use arrow keys to navigate. Press Enter to select an event. Press q to exit.',
    style: {
      fg: 'white',
    },
  })

  table.setData({
    headers: headers,
    data: formattedOutput,
  })

  // allow control the table with the keyboard
  table.focus()

  screen.append(table)
  screen.append(detailsBox)

  // Update details box when selection changes
  table.rows.on('select item', () => {
    const selectedIndex = table.rows.selected
    if (selectedIndex !== undefined && selectedIndex >= 0) {
      const selectedRow = filteredLogs[selectedIndex]
      if (selectedRow) {
        // Format the object with spacing but keep the payload compact because
        // that can contain just about anything and spread many lines.
        const obj = { ...selectedRow, payload: 'REPLACEME' }
        const json = JSON.stringify(obj, null, 2)
          .replace(
            /"payload": "REPLACEME"/,
            `"payload": ${JSON.stringify(selectedRow.payload ?? {})}`,
          )
          .replace(/^\s*"([^"]+)?"/gm, '  $1')
        // Note: the spacing works around issues with the table; it refuses to pad!
        detailsBox.setContent(json)
        screen.render()
      }
    }
  })

  screen.render()

  screen.key(['return'], () => {
    const selectedIndex = table.rows.selected
    screen.destroy()
    const selectedRow = formattedOutput[selectedIndex]
    logger.log('Last selection:\n', selectedRow)
  })
}

export async function outputAsJson(
  auditLogs: CResult<SocketSdkReturnType<'getAuditLogEvents'>['data']>,
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
  if (!auditLogs.ok) {
    return serializeResultJson(auditLogs)
  }

  return serializeResultJson({
    ok: true,
    data: {
      desc: 'Audit logs for given query',
      // Lazily access constants.ENV.VITEST.
      generated: constants.ENV.VITEST ? REDACTED : new Date().toISOString(),
      org: orgSlug,
      logType,
      page,
      nextPage: auditLogs.data.nextPage,
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
  auditLogs: SocketSdkReturnType<'getAuditLogEvents'>['data'],
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
- generated: ${constants.ENV.VITEST ? REDACTED : new Date().toISOString()}

${table}
`
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      'There was a problem converting the logs to Markdown, please try the `--json` flag',
    )
    if (isDebug()) {
      debugFn('catch: unexpected\n', e)
    }
    return ''
  }
}
