/** @fileoverview Tests for artifact alert type guards. */

import { describe, expect, it } from 'vitest'

import { isArtifactAlertCve } from './artifact.mts'

import type { CompactSocketArtifactAlert } from './artifact.mts'

describe('artifact alert utilities', () => {
  describe('isArtifactAlertCve', () => {
    it('should return true for cve type', () => {
      const alert: CompactSocketArtifactAlert = {
        type: 'cve',
      } as any

      expect(isArtifactAlertCve(alert)).toBe(true)
    })

    it('should return true for mediumCVE type', () => {
      const alert: CompactSocketArtifactAlert = {
        type: 'mediumCVE',
      } as any

      expect(isArtifactAlertCve(alert)).toBe(true)
    })

    it('should return true for mildCVE type', () => {
      const alert: CompactSocketArtifactAlert = {
        type: 'mildCVE',
      } as any

      expect(isArtifactAlertCve(alert)).toBe(true)
    })

    it('should return true for criticalCVE type', () => {
      const alert: CompactSocketArtifactAlert = {
        type: 'criticalCVE',
      } as any

      expect(isArtifactAlertCve(alert)).toBe(true)
    })

    it('should return false for non-CVE types', () => {
      const alert: CompactSocketArtifactAlert = {
        type: 'socketUpgradeAvailable',
      } as any

      expect(isArtifactAlertCve(alert)).toBe(false)
    })

    it('should return false for other alert types', () => {
      const alert: CompactSocketArtifactAlert = {
        type: 'malware',
      } as any

      expect(isArtifactAlertCve(alert)).toBe(false)
    })
  })
})
