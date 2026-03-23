/**
 * Unit tests for scan report generation test helpers.
 *
 * Purpose:
 * Tests the helper functions for creating test scan data.
 *
 * Test Coverage:
 * - getSimpleCleanScan function
 * - getScanWithEnvVars function
 * - getScanWithMultiplePackages function
 *
 * Related Files:
 * - test/helpers/generate-report-test-helpers.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  getSimpleCleanScan,
  getScanWithEnvVars,
  getScanWithMultiplePackages,
} from '../../../helpers/generate-report-test-helpers.mts'

describe('generate-report-test-helpers', () => {
  describe('getSimpleCleanScan', () => {
    it('returns an array with one artifact', () => {
      const scan = getSimpleCleanScan()

      expect(Array.isArray(scan)).toBe(true)
      expect(scan.length).toBe(1)
    })

    it('returns artifact with no alerts', () => {
      const scan = getSimpleCleanScan()

      expect(scan[0]!.alerts).toEqual([])
    })

    it('returns artifact with expected structure', () => {
      const scan = getSimpleCleanScan()
      const artifact = scan[0]!

      expect(artifact.type).toBe('npm')
      expect(artifact.name).toBe('tslib')
      expect(artifact.version).toBe('1.14.1')
      expect(artifact.score).toBeDefined()
      expect(artifact.manifestFiles).toBeDefined()
    })
  })

  describe('getScanWithEnvVars', () => {
    it('returns an array with one artifact', () => {
      const scan = getScanWithEnvVars()

      expect(Array.isArray(scan)).toBe(true)
      expect(scan.length).toBe(1)
    })

    it('returns artifact with envVars alerts', () => {
      const scan = getScanWithEnvVars()
      const artifact = scan[0]!

      expect(artifact.alerts!.length).toBe(2)
      expect(artifact.alerts![0]!.type).toBe('envVars')
      expect(artifact.alerts![1]!.type).toBe('envVars')
    })

    it('returns alerts with start/end positions', () => {
      const scan = getScanWithEnvVars()
      const alert = scan[0]!.alerts![0]!

      expect(alert.start).toBeDefined()
      expect(alert.end).toBeDefined()
      expect(typeof alert.start).toBe('number')
      expect(typeof alert.end).toBe('number')
    })
  })

  describe('getScanWithMultiplePackages', () => {
    it('returns an array with multiple artifacts', () => {
      const scan = getScanWithMultiplePackages()

      expect(Array.isArray(scan)).toBe(true)
      expect(scan.length).toBe(2)
    })

    it('returns different packages', () => {
      const scan = getScanWithMultiplePackages()

      expect(scan[0]!.name).toBe('tslib')
      expect(scan[1]!.name).toBe('lodash')
    })

    it('returns artifacts with alerts', () => {
      const scan = getScanWithMultiplePackages()

      expect(scan[0]!.alerts!.length).toBe(2)
      expect(scan[1]!.alerts!.length).toBe(1)
    })

    it('returns artifacts with different versions', () => {
      const scan = getScanWithMultiplePackages()

      expect(scan[0]!.version).toBe('1.14.1')
      expect(scan[1]!.version).toBe('4.17.21')
    })

    it('returns artifacts with manifest files', () => {
      const scan = getScanWithMultiplePackages()

      expect(scan[0]!.manifestFiles).toBeDefined()
      expect(scan[0]!.manifestFiles!.length).toBe(1)
      expect(scan[1]!.manifestFiles).toBeDefined()
      expect(scan[1]!.manifestFiles!.length).toBe(1)
    })
  })
})
