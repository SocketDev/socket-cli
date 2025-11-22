/**
 * Unit tests for analytics output formatting functions.
 *
 * Tests the data transformation and output formatting for analytics data.
 * These tests use fixture data and snapshot testing for markdown rendering.
 *
 * Test Coverage:
 * - Repository data formatting (formatDataRepo)
 * - Organization data formatting (formatDataOrg)
 * - Markdown rendering (renderMarkdown)
 * - Alert type aggregation (dynamicRequire, envVars, filesystemAccess, etc.)
 * - Time series data formatting (critical, high, medium, low alerts)
 * - Alert counts by severity level
 * - Top 5 alert types ranking
 *
 * Testing Approach:
 * - Load analytics-fixture.json for realistic test data
 * - Use inline snapshots to verify formatting output
 * - Test both org-level and repo-level data transformations
 * - Verify markdown table generation with proper headers and formatting
 *
 * Related Files:
 * - src/commands/analytics/output-analytics.mts - Implementation
 * - src/commands/analytics/analytics-fixture.json - Test fixture data
 * - src/commands/analytics/handle-analytics.mts - Handler that uses output functions
 */

import { describe, expect, it } from 'vitest'

import FIXTURE from '../../../../src/commands/analytics/analytics-fixture.json' with {
  type: 'json',
}
import {
  formatDataOrg,
  formatDataRepo,
  renderMarkdown,
} from '../../../../src/commands/analytics/output-analytics.mts'

describe('output-analytics', () => {
  describe('format data', () => {
    it('should formatDataRepo', () => {
      const str = formatDataRepo(JSON.parse(JSON.stringify(FIXTURE)))

      expect(str).toMatchInlineSnapshot(`
        {
          "top_five_alert_types": {
            "dynamicRequire": 71,
            "envVars": 636,
            "filesystemAccess": 129,
            "networkAccess": 109,
            "unmaintained": 133,
          },
          "total_critical_added": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_critical_alerts": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_critical_prevented": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_high_added": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_high_alerts": {
            "Apr 18": 13,
            "Apr 20": 13,
            "Apr 22": 10,
          },
          "total_high_prevented": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_low_added": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_low_alerts": {
            "Apr 18": 1054,
            "Apr 20": 1060,
            "Apr 22": 1059,
          },
          "total_low_prevented": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_medium_added": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_medium_alerts": {
            "Apr 18": 206,
            "Apr 20": 207,
            "Apr 22": 206,
          },
          "total_medium_prevented": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
        }
      `)
    })

    it('should formatDataOrg', () => {
      const str = formatDataOrg(JSON.parse(JSON.stringify(FIXTURE)))

      expect(str).toMatchInlineSnapshot(`
        {
          "top_five_alert_types": {
            "dynamicRequire": 274,
            "envVars": 2533,
            "filesystemAccess": 514,
            "networkAccess": 434,
            "unmaintained": 532,
          },
          "total_critical_added": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_critical_alerts": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_critical_prevented": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_high_added": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_high_alerts": {
            "Apr 18": 13,
            "Apr 20": 26,
            "Apr 22": 10,
          },
          "total_high_prevented": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_low_added": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_low_alerts": {
            "Apr 18": 1054,
            "Apr 20": 2126,
            "Apr 22": 1059,
          },
          "total_low_prevented": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_medium_added": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
          "total_medium_alerts": {
            "Apr 18": 206,
            "Apr 20": 416,
            "Apr 22": 206,
          },
          "total_medium_prevented": {
            "Apr 18": 0,
            "Apr 20": 0,
            "Apr 22": 0,
          },
        }
      `)
    })
  })

  describe('format markdown', () => {
    it('should renderMarkdown for repo', () => {
      const fdata = formatDataRepo(JSON.parse(JSON.stringify(FIXTURE)))
      const serialized = renderMarkdown(fdata, 7, 'fake_repo')

      expect(serialized).toMatchInlineSnapshot(`
        "# Socket Alert Analytics

        These are the Socket.dev analytics for the fake_repo repo of the past 7 days

        ## Total critical alerts

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total high alerts

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |     13 |
        | Apr 20 |     13 |
        | Apr 22 |     10 |
        | ------ | ------ |

        ## Total critical alerts added to the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total high alerts added to the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total critical alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total high alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total medium alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total low alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Top 5 alert types

        | Name             | Counts |
        | ---------------- | ------ |
        | envVars          |    636 |
        | unmaintained     |    133 |
        | filesystemAccess |    129 |
        | networkAccess    |    109 |
        | dynamicRequire   |     71 |
        | ---------------- | ------ |
        "
      `)
    })
  })
})
