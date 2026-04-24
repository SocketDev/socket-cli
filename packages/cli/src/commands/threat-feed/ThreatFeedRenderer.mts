/**
 * @fileoverview iocraft-based threat feed renderer.
 *
 * Non-interactive renderer for threat feed data using iocraft native bindings.
 */

import { errorMessage } from '@socketsecurity/lib/errors'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { Box, Text, print } from '../../utils/terminal/iocraft.mts'

import type { ThreatResult } from './types.mts'

const logger = getDefaultLogger()

export interface ParsedThreatResult extends ThreatResult {
  parsed: {
    ecosystem: string
    name: string
    version: string
  }
}

export interface ThreatFeedRendererProps {
  results: ParsedThreatResult[]
}

/**
 * Format time difference as human-readable string.
 */
function formatTimeDiff(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = now - date
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) {
    return 'today'
  }
  if (days === 1) {
    return 'yesterday'
  }
  return `${days} days ago`
}

/**
 * Render threat feed data using iocraft.
 *
 * Non-interactive version - displays data as a table with first entry details.
 */
export function displayThreatFeedWithIocraft({
  results,
}: ThreatFeedRendererProps): void {
  try {
    if (!results.length) {
      const tree = Box({
        children: [
          Text({
            children: 'No threats found.',
            color: 'green',
          }),
        ],
      })
      print(tree)
      return
    }

    const firstThreat = results[0]!

    const tree = Box({
    children: [
      Box({
        children: [
          Text({
            bold: true,
            children: 'Socket Threat Feed',
            color: 'red',
          }),
        ],
        marginBottom: 1,
      }),
      Box({
        borderColor: 'red',
        borderStyle: 'single',
        children: [
          Box({
            children: [
              Text({
                bold: true,
                children: [
                  'Ecosystem'.padEnd(15),
                  'Name'.padEnd(30),
                  'Version'.padEnd(15),
                  'Type'.padEnd(20),
                  'Detected'.padEnd(15),
                ].join(' '),
              }),
            ],
            marginBottom: 1,
          }),
          ...results.map(threat =>
            Box({
              children: [
                Text({
                  children: [
                    (threat.parsed?.ecosystem || '').padEnd(15),
                    (threat.parsed?.name || '').slice(0, 28).padEnd(30),
                    (threat.parsed?.version || '').slice(0, 13).padEnd(15),
                    (threat.threatType || '').slice(0, 18).padEnd(20),
                    formatTimeDiff(threat.createdAt || '').padEnd(15),
                  ].join(' '),
                }),
              ],
            }),
          ),
        ],
        flexDirection: 'column',
        marginBottom: 1,
        paddingX: 1,
        paddingY: 1,
      }),
      Box({
        borderColor: 'cyan',
        borderStyle: 'single',
        children: [
          Box({
            children: [
              Text({
                bold: true,
                children: 'First Threat Details:',
                color: 'cyan',
              }),
            ],
            marginBottom: 1,
          }),
          Box({
            children: [
              Text({
                bold: true,
                children: 'Ecosystem: ',
              }),
              Text({
                children: firstThreat.parsed?.ecosystem || 'N/A',
              }),
            ],
          }),
          Box({
            children: [
              Text({
                bold: true,
                children: 'Package: ',
              }),
              Text({
                children: firstThreat.parsed?.name || 'N/A',
              }),
            ],
          }),
          Box({
            children: [
              Text({
                bold: true,
                children: 'Version: ',
              }),
              Text({
                children: firstThreat.parsed?.version || 'N/A',
              }),
            ],
          }),
          Box({
            children: [
              Text({
                bold: true,
                children: 'Type: ',
              }),
              Text({
                children: firstThreat.threatType || 'N/A',
              }),
            ],
          }),
          Box({
            children: [
              Text({
                bold: true,
                children: 'Detected: ',
              }),
              Text({
                children: formatTimeDiff(firstThreat.createdAt || ''),
              }),
            ],
          }),
          Box({
            children: [
              Text({
                bold: true,
                children: 'URL: ',
              }),
              Text({
                children: firstThreat.locationHtmlUrl || 'N/A',
              }),
            ],
          }),
          Box({
            children: [
              Text({
                bold: true,
                children: 'Description:',
              }),
            ],
            marginTop: 1,
          }),
          Box({
            children: [
              Text({
                children: firstThreat.description || 'No description available',
              }),
            ],
          }),
        ],
        flexDirection: 'column',
        paddingX: 1,
        paddingY: 1,
      }),
    ],
    flexDirection: 'column',
  })

    print(tree)
  } catch (e) {
    process.exitCode = 1
    logger.error('Error rendering threat feed:', errorMessage(e))
    logger.warn('Falling back to plain text output')
    logger.log(`Total threats: ${results.length}`)
    results.slice(0, 10).forEach((threat, i) => {
      logger.log(`[${i + 1}] ${threat.parsed?.ecosystem || 'N/A'}/${threat.parsed?.name || 'N/A'}@${threat.parsed?.version || 'N/A'}`)
      logger.log(`    Type: ${threat.threatType || 'N/A'}`)
      logger.log(`    Created: ${threat.createdAt || 'N/A'}`)
    })
    if (results.length > 10) {
      logger.log(`... and ${results.length - 10} more threats`)
    }
  }
}
