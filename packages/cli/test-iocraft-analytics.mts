#!/usr/bin/env node
/**
 * @fileoverview Test script for iocraft analytics renderer.
 *
 * Run with: SOCKET_CLI_USE_IOCRAFT=1 node --experimental-strip-types test-iocraft-analytics.mts
 */

import { displayAnalyticsWithIocraft } from './src/commands/analytics/AnalyticsRenderer.mts'

import type { FormattedData } from './src/commands/analytics/output-analytics.mts'

const testData: FormattedData = {
  top_five_alert_types: {
    Malware: 15,
    'Supply Chain Risk': 8,
    Typosquat: 5,
    'Network Access': 3,
    'Install Scripts': 2,
  },
  total_critical_alerts: {
    '2026-03-01': 5,
    '2026-03-08': 3,
    '2026-03-15': 7,
  },
  total_high_alerts: {
    '2026-03-01': 12,
    '2026-03-08': 8,
    '2026-03-15': 10,
  },
  total_critical_added: {
    '2026-03-01': 2,
    '2026-03-15': 1,
  },
  total_critical_prevented: {
    '2026-03-08': 3,
    '2026-03-15': 2,
  },
  total_high_added: {},
  total_high_prevented: {},
  total_low_added: {},
  total_low_alerts: {},
  total_low_prevented: {},
  total_medium_added: {},
  total_medium_alerts: {},
  total_medium_prevented: {},
}

console.log('Testing iocraft analytics renderer...\n')
await displayAnalyticsWithIocraft(testData)
console.log('\n✅ iocraft analytics renderer test complete!')
