import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { msAtHome } from '../../utils/ms-at-home.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { ThreadFeedResponse, ThreatResult } from './types.mts'
import type { CResult, OutputKind } from '../../types.mts'
import type { Widgets } from 'blessed'

const require = createRequire(import.meta.url)

export async function outputThreatFeed(
  result: CResult<ThreadFeedResponse>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (!result.data?.results?.length) {
    logger.warn('Did not receive any data to display...')
    return
  }

  const formattedOutput = formatResults(result.data.results)
  const descriptions = result.data.results.map(d => d.description)

  // Note: this temporarily takes over the terminal (just like `man` does).
  const ScreenWidget = /*@__PURE__*/ require('blessed/lib/widgets/screen.js')
  // Lazily access constants.blessedOptions.
  const screen: Widgets.Screen = new ScreenWidget({
    ...constants.blessedOptions,
  })
  // Register these keys first so you can always exit, even when it gets stuck
  // If we don't do this and the code crashes, the user must hard-kill the
  // node process just to exit it. That's very bad UX.
  // eslint-disable-next-line n/no-process-exit
  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))

  const TableWidget = /*@__PURE__*/ require('blessed-contrib/lib/widget/table.js')
  const detailsBoxHeight = 20 // bottom N rows for details box
  const tipsBoxHeight = 1 // 1 row for tips box

  const table: any = new TableWidget({
    keys: 'true',
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'magenta',
    interactive: 'true',
    label: 'Threat feed',
    width: '100%',
    top: 0,
    bottom: detailsBoxHeight + tipsBoxHeight,
    border: {
      type: 'line',
      fg: 'cyan',
    },
    columnWidth: [10, 30, 20, 18, 15, 200],
    // TODO: The truncation doesn't seem to work too well yet but when we add
    //       `pad` alignment fails, when we extend columnSpacing alignment fails.
    columnSpacing: 1,
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
    content: '↑/↓: Move    Enter: Select    q/ESC: Quit',
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
    content:
      'Use arrow keys to navigate. Press Enter to select a threat. Press q to exit.',
    style: {
      fg: 'white',
    },
  })

  table.setData({
    headers: [
      ' Ecosystem',
      ' Name',
      '  Version',
      '  Threat type',
      '  Detected at',
      ' Details',
    ],
    data: formattedOutput,
  })

  // Initialize details box with the first selection if available
  if (formattedOutput.length > 0) {
    const selectedRow = formattedOutput[0]
    if (selectedRow) {
      detailsBox.setContent(formatDetailBox(selectedRow, descriptions, 0))
    }
  }

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
      const selectedRow = formattedOutput[selectedIndex]
      if (selectedRow) {
        // Note: the spacing works around issues with the table; it refuses to pad!
        detailsBox.setContent(
          formatDetailBox(selectedRow, descriptions, selectedIndex),
        )
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

function formatDetailBox(
  selectedRow: string[],
  descriptions: string[],
  selectedIndex: number,
): string {
  return (
    `Ecosystem:    ${selectedRow[0]?.trim()}\n` +
    `Name:         ${selectedRow[1]?.trim()}\n` +
    `Version:      ${selectedRow[2]?.trim()}\n` +
    `Threat type:  ${selectedRow[3]?.trim()}\n` +
    `Detected at:  ${selectedRow[4]?.trim()}\n` +
    `Details:      ${selectedRow[5]?.trim()}\n` +
    `Description:  ${descriptions[selectedIndex]?.trim()}`
  )
}

function formatResults(data: ThreatResult[]) {
  return data.map(d => {
    const ecosystem = d.purl.split('pkg:')[1]!.split('/')[0]!
    const name = d.purl.split('/')[1]!.split('@')[0]!
    const version = d.purl.split('@')[1]!

    const timeDiff = msAtHome(d.createdAt)

    // Note: the spacing works around issues with the table; it refuses to pad!
    return [
      ecosystem,
      decodeURIComponent(name),
      ` ${version}`,
      ` ${d.threatType}`,
      ` ${timeDiff}`,
      d.locationHtmlUrl,
    ]
  })
}
