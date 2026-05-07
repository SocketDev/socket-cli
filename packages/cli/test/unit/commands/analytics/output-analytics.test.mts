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
      expect(result).toMatch(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+$/)
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
