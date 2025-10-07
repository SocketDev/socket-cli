/** @fileoverview Threat feed Ink React component. */

import type { Element } from '../../utils/ink.mts'
// @ts-ignore - tsx files treated as CJS by tsgo
import { Box, InkTable, Text } from '../../utils/ink.mts'
import type { ThreatResult } from './types.mts'

export type ParsedThreatResult = ThreatResult & {
  parsed: {
    ecosystem: string
    name: string
    version: string
  }
}

export type ThreatFeedAppProps = {
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

// @ts-ignore - tsx files treated as CJS by tsgo
export function ThreatFeedApp({ results }: ThreatFeedAppProps): Element {
  // Note: Interactive features removed because stdin is piped for data transfer
  const selectedIndex = 0
  const selectedThreat = results[selectedIndex]
  const selectedPurl = selectedThreat?.parsed

  const tableData = results.map((threat, index) => {
    const { ecosystem, name, version } = threat.parsed
    return {
      ' ': index === selectedIndex ? '▶' : ' ',
      Ecosystem: ecosystem,
      Name: name,
      Version: version,
      Type: threat.threatType,
      Detected: formatTimeDiff(threat.createdAt),
    }
  })

  return (
    <Box flexDirection="column" height="100%">
      {/* Table */}
      <Box flexGrow={1} flexShrink={1} overflowY="hidden">
        <InkTable data={tableData} />
      </Box>

      {/* Tips */}
      <Box borderStyle="single" borderColor="yellow" paddingX={1}>
        <Text color="yellow">↑/↓: Move q/ESC: Quit</Text>
      </Box>

      {/* Details */}
      <Box
        borderStyle="single"
        borderColor="cyan"
        flexDirection="column"
        height={20}
        paddingX={1}
      >
        <Text bold color="cyan">
          Details
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text bold>Ecosystem:</Text> {selectedPurl?.ecosystem || 'N/A'}
          </Text>
          <Text>
            <Text bold>Package:</Text> {selectedPurl?.name || 'N/A'}
          </Text>
          <Text>
            <Text bold>Version:</Text> {selectedPurl?.version || 'N/A'}
          </Text>
          <Text>
            <Text bold>Type:</Text> {selectedThreat?.threatType || 'N/A'}
          </Text>
          <Text>
            <Text bold>Detected:</Text>{' '}
            {selectedThreat ? formatTimeDiff(selectedThreat.createdAt) : 'N/A'}
          </Text>
          <Text>
            <Text bold>URL:</Text> {selectedThreat?.locationHtmlUrl || 'N/A'}
          </Text>
          <Box marginTop={1}>
            <Text bold>Description:</Text>
          </Box>
          <Text>
            {selectedThreat?.description || 'No description available'}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
