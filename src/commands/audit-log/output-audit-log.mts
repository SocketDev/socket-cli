import { createRequire } from 'node:module'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { OUTPUT_JSON, OUTPUT_MARKDOWN } from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { mdTable } from '../../utils/markdown.mts'
import { msAtHome } from '../../utils/ms-at-home.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
import type { Widgets } from 'blessed'

const require = createRequire(import.meta.url)

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

function formatResult(
  selectedRow?: SocketSdkSuccessResult<'getAuditLogEvents'>['data']['results'][number],
  keepQuotes = false,
): string {
  if (!selectedRow) {
    return '(none)'
  }
  // Format the object with spacing but keep the payload compact because
  // that can contain just about anything and spread many lines.
  const obj = { ...selectedRow, payload: 'REPLACEME' }
  const json = JSON.stringify(obj, null, 2).replace(
    /"payload": "REPLACEME"/,
    `"payload": ${JSON.stringify(selectedRow.payload ?? {})}`,
  )
  if (keepQuotes) {
    return json
  }
  return json.replace(/^\s*"([^"]+)?"/gm, '  $1')
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
      generated: constants.ENV.VITEST
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
- generated: ${constants.ENV.VITEST ? constants.REDACTED : new Date().toISOString()}

${table}
`
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      'There was a problem converting the logs to Markdown, please try the `--json` flag',
    )
    debugFn('error', 'caught: markdown conversion error')
    debugDir('inspect', { error: e })
    return 'Failed to generate the markdown report'
  }
}

async function outputWithBlessed(
  data: SocketSdkSuccessResult<'getAuditLogEvents'>['data'],
  orgSlug: string,
) {
  const filteredLogs = data.results
  const formattedOutput = filteredLogs.map(logs => [
    logs.event_id ?? '',
    msAtHome(logs.created_at ?? ''),
    logs.type ?? '',
    logs.user_email ?? '',
    logs.ip_address ?? '',
    logs.user_agent ?? '',
  ])
  const headers = [
    ' Event id',
    ' Created at',
    ' Event type',
    ' User email',
    ' IP address',
    ' User agent',
  ]

  // Note: this temporarily takes over the terminal (just like `man` does).
  const ScreenWidget = /*@__PURE__*/ require('blessed/lib/widgets/screen.js')
  const screen: Widgets.Screen = new ScreenWidget({
    ...constants.blessedOptions,
  })
  // Register these keys first so you can always exit, even when it gets stuck
  // If we don't do this and the code crashes, the user must hard-kill the
  // node process just to exit it. That's very bad UX.
  // eslint-disable-next-line n/no-process-exit
  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))

  const TableWidget = /*@__PURE__*/ require('blessed-contrib/lib/widget/table.js')
  const tipsBoxHeight = 1 // 1 row for tips box
  const detailsBoxHeight = 20 // bottom N rows for details box. 20 gives 4 lines for condensed payload before it scrolls out of view

  const maxWidths = headers.map(s => s.length + 1)
  formattedOutput.forEach(row => {
    row.forEach((str, i) => {
      maxWidths[i] = Math.max(str.length, maxWidths[i] ?? str.length)
    })
  })

  const table: any = new TableWidget({
    keys: 'true',
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'magenta',
    interactive: 'true',
    label: `Audit Logs for ${orgSlug}`,
    width: '100%',
    top: 0,
    bottom: detailsBoxHeight + tipsBoxHeight,
    border: {
      type: 'line',
      fg: 'cyan',
    },
    columnWidth: maxWidths, //[10, 30, 40, 25, 15, 200],
    // Note: spacing works as long as you don't reserve more than total width
    columnSpacing: 4,
    truncate: '_',
  })

  const BoxWidget = /*@__PURE__*/ require('blessed/lib/widgets/box.js')
  const tipsBox: Widgets.BoxElement = new BoxWidget({
    bottom: detailsBoxHeight, // sits just above the details box
    height: tipsBoxHeight,
    width: '100%',
    style: {
      fg: 'yellow',
      bg: 'black',
    },
    tags: true,
    content: `↑/↓: Move    Enter: Select    q/ESC: Quit`,
  })
  const detailsBox: Widgets.BoxElement = new BoxWidget({
    bottom: 0,
    height: detailsBoxHeight,
    width: '100%',
    border: {
      type: 'line',
      fg: 'cyan',
    },
    label: 'Details',
    content: formatResult(filteredLogs[0], true),
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

  // Stacking order: table (top), tipsBox (middle), detailsBox (bottom)
  screen.append(table)
  screen.append(tipsBox)
  screen.append(detailsBox)

  // Update details box when selection changes
  table.rows.on('select item', () => {
    const selectedIndex = table.rows.selected
    if (selectedIndex !== undefined && selectedIndex >= 0) {
      const selectedRow = filteredLogs[selectedIndex]
      detailsBox.setContent(formatResult(selectedRow))
      screen.render()
    }
  })

  screen.render()

  screen.key(['return'], () => {
    const selectedIndex = table.rows.selected
    screen.destroy()
    const selectedRow = formattedOutput[selectedIndex]
      ? formatResult(filteredLogs[selectedIndex], true)
      : '(none)'
    logger.log(`Last selection:\n${selectedRow.trim()}`)
  })
}
