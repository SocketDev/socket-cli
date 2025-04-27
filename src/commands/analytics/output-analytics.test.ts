import { describe, expect, it } from 'vitest'

import FIXTURE from './analytics-fixture.json' with { type: 'json' }
import {
  formatDataOrg,
  formatDataRepo,
  renderMarkdown
} from './output-analytics'

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
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_critical_alerts": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_critical_prevented": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_high_added": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_high_alerts": {
            "Apr 18": 13,
            "Apr 19": 13,
            "Apr 20": 13,
            "Apr 21": 10,
          },
          "total_high_prevented": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_low_added": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_low_alerts": {
            "Apr 18": 1054,
            "Apr 19": 1060,
            "Apr 20": 1066,
            "Apr 21": 1059,
          },
          "total_low_prevented": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_medium_added": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_medium_alerts": {
            "Apr 18": 206,
            "Apr 19": 207,
            "Apr 20": 209,
            "Apr 21": 206,
          },
          "total_medium_prevented": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
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
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_critical_alerts": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_critical_prevented": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_high_added": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_high_alerts": {
            "Apr 18": 13,
            "Apr 19": 13,
            "Apr 20": 13,
            "Apr 21": 10,
          },
          "total_high_prevented": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_low_added": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_low_alerts": {
            "Apr 18": 1054,
            "Apr 19": 1060,
            "Apr 20": 1066,
            "Apr 21": 1059,
          },
          "total_low_prevented": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_medium_added": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
          },
          "total_medium_alerts": {
            "Apr 18": 206,
            "Apr 19": 207,
            "Apr 20": 209,
            "Apr 21": 206,
          },
          "total_medium_prevented": {
            "Apr 18": 0,
            "Apr 19": 0,
            "Apr 20": 0,
            "Apr 21": 0,
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
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | ------ | ------ |

        ## Total high alerts

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |     13 |
        | Apr 20 |     13 |
        | Apr 19 |     13 |
        | Apr 21 |     10 |
        | ------ | ------ |

        ## Total critical alerts added to the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | ------ | ------ |

        ## Total high alerts added to the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | ------ | ------ |

        ## Total critical alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | ------ | ------ |

        ## Total high alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | ------ | ------ |

        ## Total medium alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
        | ------ | ------ |

        ## Total low alerts prevented from the main branch

        | Date   | Counts |
        | ------ | ------ |
        | Apr 18 |      0 |
        | Apr 20 |      0 |
        | Apr 19 |      0 |
        | Apr 21 |      0 |
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
