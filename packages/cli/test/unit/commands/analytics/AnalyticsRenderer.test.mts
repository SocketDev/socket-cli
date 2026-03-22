import { describe, expect, it } from 'vitest'

import { renderToString } from '../../../../src/utils/terminal/iocraft.mts'
import { Box, Text } from '../../../../src/utils/terminal/iocraft.mts'
import { formatDataRepo } from '../../../../src/commands/analytics/output-analytics.mts'
import FIXTURE from '../../../../src/commands/analytics/analytics-fixture.json' with { type: 'json' }

import type { FormattedData } from '../../../../src/commands/analytics/output-analytics.mts'

describe('AnalyticsRenderer', () => {
  describe('empty data handling', () => {
    it('should render empty state when no data available', () => {
      const emptyData: FormattedData = {
        top_five_alert_types: {},
        total_critical_alerts: {},
        total_high_alerts: {},
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

      const tree = Box({
        children: [
          Text({
            children: 'No analytics data available for this period.',
            color: 'yellow',
          }),
        ],
      })

      const output = renderToString(tree)
      expect(output).toMatchInlineSnapshot(`
        "No analytics data available for this period.
        "
      `)
    })
  })

  describe('data rendering', () => {
    it('should render analytics with fixture data', () => {
      const fdata = formatDataRepo(JSON.parse(JSON.stringify(FIXTURE)))

      const tree = Box({
        children: [
          Box({
            children: [
              Text({
                bold: true,
                children: 'Socket Analytics',
                color: 'cyan',
              }),
            ],
            marginBottom: 1,
          }),
          Box({
            borderColor: 'cyan',
            borderStyle: 'single',
            children: [
              Box({
                children: [Text({ bold: true, children: 'Top 5 Alert Types:' })],
                marginBottom: 1,
              }),
              ...Object.entries(fdata.top_five_alert_types).map(({ 0: type, 1: count }) =>
                Box({
                  children: [Text({ children: `  ${type}: ${count}` })],
                }),
              ),
            ],
            flexDirection: 'column',
            marginBottom: 1,
            paddingX: 1,
            paddingY: 1,
          }),
          Box({
            borderColor: 'red',
            borderStyle: 'single',
            children: [
              Box({
                children: [
                  Text({ bold: true, children: 'Critical Alerts', color: 'red' }),
                ],
                marginBottom: 1,
              }),
              ...Object.entries(fdata.total_critical_alerts).map(({ 0: date, 1: count }) =>
                Box({
                  children: [Text({ children: `  ${date}: ${count}` })],
                }),
              ),
            ],
            flexDirection: 'column',
            marginBottom: 1,
            paddingX: 1,
            paddingY: 1,
          }),
          Box({
            borderColor: 'yellow',
            borderStyle: 'single',
            children: [
              Box({
                children: [
                  Text({ bold: true, children: 'High Alerts', color: 'yellow' }),
                ],
                marginBottom: 1,
              }),
              ...Object.entries(fdata.total_high_alerts).map(({ 0: date, 1: count }) =>
                Box({
                  children: [Text({ children: `  ${date}: ${count}` })],
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
