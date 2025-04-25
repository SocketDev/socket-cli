import { describe, expect, it } from 'vitest'

import FIXTURE from './analytics-fixture.json' with { type: 'json' }
import { formatDataOrg, formatDataRepo } from './output-analytics'

describe('output-analytics', () => {
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
