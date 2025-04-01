// @ts-ignore
import BoxWidget from 'blessed/lib/widgets/box'
// @ts-ignore
import ScreenWidget from 'blessed/lib/widgets/screen'
// @ts-ignore
import TableWidget from 'blessed-contrib/lib/widget/table'

import { logger } from '@socketsecurity/registry/lib/logger'

import { ThreadFeedResponse, ThreatResult } from './types'

import type { Widgets } from 'blessed'

export async function outputThreatFeed(
  data: ThreadFeedResponse,
  {
    outputKind
  }: {
    outputKind: 'json' | 'markdown' | 'text'
  }
) {
  if (outputKind === 'json') {
    logger.log(data)
    return
  }

  if (!data?.results?.length) {
    logger.error('Did not receive any data to display...')
    return
  }

  const formattedOutput = formatResults(data.results)
  const descriptions = data.results.map(d => d.description)

  // Note: this temporarily takes over the terminal (just like `man` does).
  const screen: Widgets.Screen = new ScreenWidget()
  // Register these keys first so you can always exit, even when it gets stuck
  // If we don't do this and the code crashes, the user must hard-kill the
  // node process just to exit it. That's very bad UX.
  screen.key(['escape', 'q', 'C-c'], () => process.exit(0))

  const table: any = new TableWidget({
    keys: 'true',
    fg: 'white',
    selectedFg: 'white',
    selectedBg: 'magenta',
    interactive: 'true',
    label: 'Threat feed',
    width: '100%',
    height: '70%', // Changed from 100% to 70%
    border: {
      type: 'line',
      fg: 'cyan'
    },
    columnWidth: [10, 30, 20, 18, 15, 200],
    // TODO: the truncation doesn't seem to work too well yet but when we add
    //       `pad` alignment fails, when we extend columnSpacing alignment fails
    columnSpacing: 1,
    truncate: '_'
  })

  // Create details box at the bottom
  const detailsBox: Widgets.BoxElement = new BoxWidget({
    bottom: 0,
    height: '30%',
    width: '100%',
    border: {
      type: 'line',
      fg: 'cyan'
    },
    label: 'Details',
    content:
      'Use arrow keys to navigate. Press Enter to select a threat. Press q to exit.',
    style: {
      fg: 'white'
    }
  })

  table.setData({
    headers: [
      ' Ecosystem',
      ' Name',
      '  Version',
      '  Threat type',
      '  Detected at',
      ' Details'
    ],
    data: formattedOutput
  })

  // allow control the table with the keyboard
  table.focus()

  screen.append(table)
  screen.append(detailsBox)

  // Update details box when selection changes
  table.rows.on('select item', () => {
    const selectedIndex = table.rows.selected
    if (selectedIndex !== undefined && selectedIndex >= 0) {
      const selectedRow = formattedOutput[selectedIndex]
      if (selectedRow) {
        // Note: the spacing works around issues with the table; it refuses to pad!
        detailsBox.setContent(
          `Ecosystem: ${selectedRow[0]}\n` +
            `Name: ${selectedRow[1]}\n` +
            `Version:${selectedRow[2]}\n` +
            `Threat type:${selectedRow[3]}\n` +
            `Detected at:${selectedRow[4]}\n` +
            `Details: ${selectedRow[5]}\n` +
            `Description: ${descriptions[selectedIndex]}`
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
      d.locationHtmlUrl
    ]
  })
}

function msAtHome(isoTimeStamp: string): string {
  const timeStart = Date.parse(isoTimeStamp)
  const timeEnd = Date.now()

  const rtf = new Intl.RelativeTimeFormat('en', {
    numeric: 'always',
    style: 'short'
  })

  const delta = timeEnd - timeStart
  if (delta < 60 * 60 * 1000) {
    return rtf.format(-Math.round(delta / (60 * 1000)), 'minute')
    // return Math.round(delta / (60 * 1000)) + ' min ago'
  } else if (delta < 24 * 60 * 60 * 1000) {
    return rtf.format(-(delta / (60 * 60 * 1000)).toFixed(1), 'hour')
    // return (delta / (60 * 60 * 1000)).toFixed(1) + ' hr ago'
  } else if (delta < 7 * 24 * 60 * 60 * 1000) {
    return rtf.format(-(delta / (24 * 60 * 60 * 1000)).toFixed(1), 'day')
    // return (delta / (24 * 60 * 60 * 1000)).toFixed(1) + ' day ago'
  } else {
    return isoTimeStamp.slice(0, 10)
  }
}
