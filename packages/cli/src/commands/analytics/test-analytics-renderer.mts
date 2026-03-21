/**
 * @fileoverview Manual test for analytics iocraft renderer.
 *
 * SETUP: Run once before testing:
 *   node scripts/setup-iocraft-dev.mjs
 *
 * RUN TEST:
 *   node --experimental-strip-types src/commands/analytics/test-analytics-renderer.mts
 */

import { displayAnalyticsWithIocraft } from './AnalyticsRenderer.mts'

// Mock data for testing
const mockData = {
  top_five_alert_types: {
    'npm-install-script': 25,
    'deprecated-package': 18,
    'unmaintained-package': 12,
    'vulnerable-dependency': 8,
    'suspicious-code': 5,
  },
  total_critical_alerts: {
    'Mar 1': 3,
    'Mar 5': 5,
    'Mar 10': 2,
    'Mar 15': 7,
    'Mar 20': 4,
  },
  total_high_alerts: {
    'Mar 1': 12,
    'Mar 5': 15,
    'Mar 10': 10,
    'Mar 15': 18,
    'Mar 20': 14,
  },
  total_medium_alerts: {},
  total_low_alerts: {},
  total_critical_added: {},
  total_medium_added: {},
  total_low_added: {},
  total_high_added: {},
  total_critical_prevented: {},
  total_high_prevented: {},
  total_medium_prevented: {},
  total_low_prevented: {},
}

console.log('Testing Analytics Renderer with iocraft\n')
displayAnalyticsWithIocraft(mockData)
console.log('\n✅ Analytics renderer test complete')
