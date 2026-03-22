import { describe, expect, it } from 'vitest'

import { renderToString } from '../../../../src/utils/terminal/iocraft.mts'
import { Box, Text } from '../../../../src/utils/terminal/iocraft.mts'

import type { ParsedThreatResult } from '../../../../src/commands/threat-feed/ThreatFeedRenderer.mts'

describe('ThreatFeedRenderer', () => {
  describe('empty data handling', () => {
    it('should render empty state when no threats found', () => {
      const tree = Box({
        children: [
          Text({
            children: 'No threats found.',
            color: 'green',
          }),
        ],
      })

      const output = renderToString(tree)
      expect(output).toMatchInlineSnapshot(`
        "No threats found.
        "
      `)
    })
  })

  describe('data rendering', () => {
    it('should render threat feed table with multiple threats', () => {
      const results: ParsedThreatResult[] = [
        {
          createdAt: '2024-04-19T10:30:00Z',
          description: 'Malicious package detected',
          locationHtmlUrl: 'https://socket.dev/npm/package/malicious-pkg',
          purl: 'pkg:npm/malicious-pkg@1.0.0',
          threatType: 'malware',
          parsed: {
            ecosystem: 'npm',
            name: 'malicious-pkg',
            version: '1.0.0',
          },
        },
        {
          createdAt: '2024-04-18T15:20:00Z',
          description: 'Package contains obfuscated code',
          locationHtmlUrl: 'https://socket.dev/npm/package/suspicious-lib',
          purl: 'pkg:npm/suspicious-lib@2.1.0',
          threatType: 'obfuscation',
          parsed: {
            ecosystem: 'npm',
            name: 'suspicious-lib',
            version: '2.1.0',
          },
        },
      ]

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
                        threat.parsed.ecosystem.padEnd(15),
                        threat.parsed.name.slice(0, 28).padEnd(30),
                        threat.parsed.version.slice(0, 13).padEnd(15),
                        threat.threatType.slice(0, 18).padEnd(20),
                        'test-date'.padEnd(15),
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
        ],
        flexDirection: 'column',
      })

      const output = renderToString(tree)
      expect(output).toMatchSnapshot()
    })
  })
})
