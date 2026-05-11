import { describe, expect, it } from 'vitest'

import FIXTURE from '../../../../src/commands/analytics/analytics-fixture.json' with { type: 'json' }
import {
  formatDataOrg,
  formatDataRepo,
  formatDate,
  renderMarkdown,
} from '../../../../src/commands/analytics/output-analytics.mts'

// formatDate() in output-analytics.mts uses local-time getMonth() /
// getDate() — the user-visible output is intentionally local. The
// snapshots encode UTC-day dates (e.g. "Apr 19" for 2025-04-19T04:50Z),
// matching CI runners which are UTC. scripts/test-wrapper.mts pins TZ
// to UTC for the spawned vitest process so these snapshots are stable
// across developer timezones.
describe('output-analytics', () => {
  describe('format data', () => {
    it('should formatDataRepo', () => {
      const str = formatDataRepo(JSON.parse(JSON.stringify(FIXTURE)))

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
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_critical_alerts": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_critical_prevented": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_high_added": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_high_alerts": {
            "Apr 19": 13,
            "Apr 20": 13,
            "Apr 21": 13,
            "Apr 22": 10,
          },
          "total_high_prevented": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_low_added": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_low_alerts": {
            "Apr 19": 1054,
            "Apr 20": 1060,
            "Apr 21": 1066,
            "Apr 22": 1059,
          },
          "total_low_prevented": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_medium_added": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_medium_alerts": {
            "Apr 19": 206,
            "Apr 20": 207,
            "Apr 21": 209,
            "Apr 22": 206,
          },
          "total_medium_prevented": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
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
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_critical_alerts": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_critical_prevented": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_high_added": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_high_alerts": {
            "Apr 19": 13,
            "Apr 20": 13,
            "Apr 21": 13,
            "Apr 22": 10,
          },
          "total_high_prevented": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_low_added": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_low_alerts": {
            "Apr 19": 1054,
            "Apr 20": 1060,
            "Apr 21": 1066,
            "Apr 22": 1059,
          },
          "total_low_prevented": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_medium_added": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
          "total_medium_alerts": {
            "Apr 19": 206,
            "Apr 20": 207,
            "Apr 21": 209,
            "Apr 22": 206,
          },
          "total_medium_prevented": {
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
            "Apr 22": 0,
          },
        }
      `)
    })
  })

  describe('format data with same-date aggregation', () => {
    it('aggregates metrics across entries that share a date (line 272)', () => {
      // Two entries on the same day, formatDataOrg sums their metrics into
      // the same date bucket. The else-branch creates the first entry; the
      // if-branch adds onto it.
      const data = [
        {
          created_at: '2025-05-01T01:00:00Z',
          top_five_alert_types: { alpha: 5 },
          total_critical_alerts: 1,
          total_high_alerts: 2,
          total_medium_alerts: 3,
          total_low_alerts: 4,
          total_critical_added: 0,
          total_high_added: 0,
          total_medium_added: 0,
          total_low_added: 0,
          total_critical_prevented: 0,
          total_high_prevented: 0,
          total_medium_prevented: 0,
          total_low_prevented: 0,
        },
        {
          created_at: '2025-05-01T02:00:00Z', // same day
          top_five_alert_types: { alpha: 7 },
          total_critical_alerts: 10,
          total_high_alerts: 20,
          total_medium_alerts: 30,
          total_low_alerts: 40,
          total_critical_added: 0,
          total_high_added: 0,
          total_medium_added: 0,
          total_low_added: 0,
          total_critical_prevented: 0,
          total_high_prevented: 0,
          total_medium_prevented: 0,
          total_low_prevented: 0,
        },
      ] as any

      const result = formatDataOrg(data)
      // Both entries on the same day get the same date key after formatDate;
      // we look up that single key dynamically so we don't depend on the
      // exact format string.
      const criticalKeys = Object.keys(result.total_critical_alerts)
      expect(criticalKeys.length).toBe(1)
      const dateKey = criticalKeys[0]!
      expect(result.total_critical_alerts[dateKey]).toBe(11)
      expect(result.total_high_alerts[dateKey]).toBe(22)
      // top_five aggregation also doubles up: 5 + 7 = 12.
      expect(result.top_five_alert_types['alpha']).toBe(12)
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
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total high alerts

        | Date   | Counts |
        | ------ | ------ |
        | Apr 19 |     13 |
        | Apr 21 |     13 |
        | Apr 20 |     13 |
        | Apr 22 |     10 |
        | ------ | ------ |

        ## Total critical alerts added to the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total high alerts added to the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total critical alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total high alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total medium alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Total low alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | Apr 20 |      0 |
        | Apr 22 |      0 |
        | ------ | ------ |

        ## Top 5 alert types

        | Name             | Counts |
        | ---------------- | ------ |
        | envVars          |   2533 |
        | unmaintained     |    532 |
        | filesystemAccess |    514 |
        | networkAccess    |    434 |
        | dynamicRequire   |    274 |
        | ---------------- | ------ |
        "
      `)
    })
  })

  describe('formatDate', () => {
    it('formats valid dates as "MonthName Day"', () => {
      const result = formatDate('2026-03-15T00:00:00Z')
      expect(result).toMatch(
        /^(Apr|Aug|Dec|Feb|Jan|Jul|Jun|Mar|May|Nov|Oct|Sep) \d+$/,
      )
    })

    it('returns first 10 chars for invalid date strings', () => {
      // Invalid date string → getMonth/getDate return NaN → fallback path.
      const result = formatDate('not-a-real-date')
      expect(result).toBe('not-a-real')
    })

    it('returns truncated input when date does not parse', () => {
      const result = formatDate('XXXX-YY-ZZ')
      expect(result).toBe('XXXX-YY-ZZ')
    })
  })
})
