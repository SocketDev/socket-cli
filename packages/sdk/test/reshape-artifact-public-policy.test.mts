/** @fileoverview Tests for reshapeArtifactForPublicPolicy function edge cases. */

import { describe, expect, it } from 'vitest'

import { reshapeArtifactForPublicPolicy } from '../src/http-client.js'

describe('reshapeArtifactForPublicPolicy - Complete Coverage', () => {
  describe('when user is authenticated', () => {
    it('should return data unchanged for authenticated users', () => {
      const data = {
        artifacts: [{ name: 'test', alerts: [{ severity: 'high' }] }],
      }

      const result = reshapeArtifactForPublicPolicy(data, true)

      expect(result).toBe(data)
    })
  })

  describe('when user is not authenticated', () => {
    describe('object with artifacts array', () => {
      it('should reshape artifacts array for unauthenticated users', () => {
        const data = {
          artifacts: [
            {
              name: 'test-package',
              version: '1.0.0',
              size: 1000,
              author: 'test-author',
              type: 'npm',
              supplyChainRisk: 0.5,
              scorecards: { overall: 8 },
              topLevelAncestors: ['parent'],
              extra: 'should-be-removed',
              alerts: [
                {
                  type: 'typo',
                  severity: 'high',
                  key: 'alert1',
                  action: 'warn',
                },
                {
                  type: 'malware',
                  severity: 'low',
                  key: 'alert2',
                  action: 'block',
                },
                {
                  type: 'vuln',
                  severity: 'medium',
                  key: 'alert3',
                  action: 'warn',
                },
              ],
            },
          ],
          metadata: 'should-remain',
        }

        const result = reshapeArtifactForPublicPolicy(data, false)

        expect(result).toEqual({
          artifacts: [
            {
              name: 'test-package',
              version: '1.0.0',
              size: 1000,
              author: 'test-author',
              type: 'npm',
              supplyChainRisk: 0.5,
              scorecards: { overall: 8 },
              topLevelAncestors: ['parent'],
              alerts: [
                { type: 'typo', severity: 'high', key: 'alert1' },
                { type: 'vuln', severity: 'medium', key: 'alert3' },
              ],
            },
          ],
          metadata: 'should-remain',
        })
      })

      it('should filter alerts by actions when provided', () => {
        const data = {
          artifacts: [
            {
              name: 'test',
              alerts: [
                {
                  severity: 'high',
                  action: 'warn',
                  type: 'typo',
                  key: 'alert1',
                },
                {
                  severity: 'medium',
                  action: 'block',
                  type: 'malware',
                  key: 'alert2',
                },
                {
                  severity: 'high',
                  action: 'ignore',
                  type: 'vuln',
                  key: 'alert3',
                },
              ],
            },
          ],
        }

        const result = reshapeArtifactForPublicPolicy(data, false, 'warn,block')

        expect(result.artifacts?.[0]?.alerts).toEqual([
          { type: 'typo', severity: 'high', key: 'alert1' },
          { type: 'malware', severity: 'medium', key: 'alert2' },
        ])
      })

      it('should handle artifacts with no alerts', () => {
        const data = {
          artifacts: [
            {
              name: 'test-package',
              version: '1.0.0',
            },
          ],
        }

        const result = reshapeArtifactForPublicPolicy(data, false)

        expect(result.artifacts?.[0]).toEqual({
          name: 'test-package',
          version: '1.0.0',
        })
      })
    })

    describe('single artifact with alerts', () => {
      it('should reshape single artifact for unauthenticated users', () => {
        const data = {
          name: 'single-package',
          version: '2.0.0',
          size: 2000,
          author: 'single-author',
          type: 'npm',
          supplyChainRisk: 0.3,
          scorecards: { overall: 9 },
          topLevelAncestors: ['ancestor'],
          extra: 'should-be-removed',
          alerts: [
            { type: 'typo', severity: 'high', key: 'alert1', action: 'warn' },
            {
              type: 'malware',
              severity: 'low',
              key: 'alert2',
              action: 'block',
            },
          ],
        }

        const result = reshapeArtifactForPublicPolicy(data, false)

        expect(result).toEqual({
          name: 'single-package',
          version: '2.0.0',
          size: 2000,
          author: 'single-author',
          type: 'npm',
          supplyChainRisk: 0.3,
          scorecards: { overall: 9 },
          topLevelAncestors: ['ancestor'],
          alerts: [{ type: 'typo', severity: 'high', key: 'alert1' }],
        })
      })

      it('should filter single artifact alerts by actions', () => {
        const data = {
          name: 'test',
          alerts: [
            { severity: 'high', action: 'warn', type: 'typo', key: 'alert1' },
            {
              severity: 'medium',
              action: 'block',
              type: 'malware',
              key: 'alert2',
            },
          ],
        }

        const result = reshapeArtifactForPublicPolicy(data, false, 'block')

        expect(result.alerts).toEqual([
          { type: 'malware', severity: 'medium', key: 'alert2' },
        ])
      })
    })

    describe('data with neither artifacts nor alerts', () => {
      it('should return data unchanged when no artifacts or alerts present', () => {
        const data = {
          metadata: 'some-data',
          info: 'other-info',
        }

        const result = reshapeArtifactForPublicPolicy(data, false)

        expect(result).toBe(data)
      })
    })

    describe('edge cases with actions parameter', () => {
      it('should handle empty actions string', () => {
        const data = {
          alerts: [
            { severity: 'high', action: 'warn', type: 'typo', key: 'alert1' },
          ],
        }

        const result = reshapeArtifactForPublicPolicy(data, false, '')

        expect(result.alerts).toEqual([
          { type: 'typo', severity: 'high', key: 'alert1' },
        ])
      })

      it('should handle undefined actions parameter', () => {
        const data = {
          alerts: [
            { severity: 'high', action: 'warn', type: 'typo', key: 'alert1' },
          ],
        }

        const result = reshapeArtifactForPublicPolicy(data, false, undefined)

        expect(result.alerts).toEqual([
          { type: 'typo', severity: 'high', key: 'alert1' },
        ])
      })
    })
  })
})
