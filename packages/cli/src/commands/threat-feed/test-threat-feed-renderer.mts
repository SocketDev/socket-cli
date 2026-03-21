/**
 * @fileoverview Manual test for threat-feed iocraft renderer.
 *
 * SETUP: Run once before testing:
 *   node scripts/setup-iocraft-dev.mjs
 *
 * RUN TEST:
 *   node --experimental-strip-types src/commands/threat-feed/test-threat-feed-renderer.mts
 */

import { displayThreatFeedWithIocraft } from './ThreatFeedRenderer.mts'

// Mock data for testing
const mockResults = [
  {
    purl: 'pkg:npm/malicious-package@1.0.0',
    threatType: 'malware',
    createdAt: '2026-03-20T10:00:00Z',
    description: 'Package contains obfuscated code that exfiltrates environment variables to a remote server.',
    locationHtmlUrl: 'https://socket.dev/npm/package/malicious-package',
    parsed: {
      ecosystem: 'npm',
      name: 'malicious-package',
      version: '1.0.0',
    },
  },
  {
    purl: 'pkg:npm/typosquat-example@2.1.0',
    threatType: 'typosquatting',
    createdAt: '2026-03-19T15:30:00Z',
    description: 'Package name is a typosquat of popular package "example", attempting to trick developers into installing it.',
    locationHtmlUrl: 'https://socket.dev/npm/package/typosquat-example',
    parsed: {
      ecosystem: 'npm',
      name: 'typosquat-example',
      version: '2.1.0',
    },
  },
  {
    purl: 'pkg:npm/backdoor-lib@3.0.1',
    threatType: 'supply-chain-attack',
    createdAt: '2026-03-18T08:15:00Z',
    description: 'Legitimate package compromised in version 3.0.1, includes backdoor in install script.',
    locationHtmlUrl: 'https://socket.dev/npm/package/backdoor-lib',
    parsed: {
      ecosystem: 'npm',
      name: 'backdoor-lib',
      version: '3.0.1',
    },
  },
]

console.log('Testing Threat Feed Renderer with iocraft\n')
displayThreatFeedWithIocraft({ results: mockResults })
console.log('\n✅ Threat feed renderer test complete')
