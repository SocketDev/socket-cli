import constants from '../../constants'

import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { components } from '@socketsecurity/sdk/types/api'

export type ArtifactAlertCve = Remap<
  Omit<CompactSocketArtifactAlert, 'type'> & {
    type: CveAlertType
  }
>

export type ArtifactAlertCveFixable = Remap<
  Omit<CompactSocketArtifactAlert, 'props' | 'type'> & {
    type: CveAlertType
    props: {
      firstPatchedVersionIdentifier: string
      vulnerableVersionRange: string
      [key: string]: any
    }
  }
>

export type ArtifactAlertUpgrade = Remap<
  Omit<CompactSocketArtifactAlert, 'type'> & {
    type: 'socketUpgradeAvailable'
  }
>

export type CveAlertType = 'cve' | 'mediumCVE' | 'mildCVE' | 'criticalCVE'

export type CompactSocketArtifactAlert = Remap<
  Omit<SocketArtifactAlert, 'category' | 'end' | 'file' | 'start'>
>

export type CompactSocketArtifact = Remap<
  Omit<SocketArtifact, 'alerts' | 'batchIndex' | 'size'> & {
    alerts: CompactSocketArtifactAlert[]
  }
>

export type SocketArtifact = components['schemas']['SocketArtifact']

export type SocketArtifactAlert = Remap<
  Omit<components['schemas']['SocketAlert'], 'props'> & {
    props?: any | undefined
  }
>

const {
  ALERT_TYPE_CRITICAL_CVE,
  ALERT_TYPE_CVE,
  ALERT_TYPE_MEDIUM_CVE,
  ALERT_TYPE_MILD_CVE
} = constants

export function isArtifactAlertCve(
  alert: CompactSocketArtifactAlert
): alert is ArtifactAlertCve {
  const { type } = alert
  return (
    type === ALERT_TYPE_CVE ||
    type === ALERT_TYPE_MEDIUM_CVE ||
    type === ALERT_TYPE_MILD_CVE ||
    type === ALERT_TYPE_CRITICAL_CVE
  )
}
