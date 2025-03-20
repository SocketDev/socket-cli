import constants from '../../constants'

import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { components } from '@socketsecurity/sdk/types/api'

export type ArtifactAlertCve = Remap<
  Omit<CompactSocketArtifactAlert, 'type'> & {
    type: CveAlertType
  }
>

export type ArtifactAlertCveFixable = Remap<
  Omit<CompactSocketArtifactAlert, 'props'> & {
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
  Omit<
    SocketArtifactAlert,
    'action' | 'actionPolicyIndex' | 'category' | 'end' | 'file' | 'start'
  >
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
  ALERT_TYPE_MILD_CVE,
  ALERT_TYPE_SOCKET_UPGRADE_AVAILABLE,
  CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER,
  CVE_ALERT_PROPS_VULNERABLE_VERSION_RANGE
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

export function isArtifactAlertCveFixable(
  alert: CompactSocketArtifactAlert
): alert is ArtifactAlertCveFixable {
  if (!isArtifactAlertCve(alert)) {
    return false
  }
  const { props } = alert
  return (
    !!props?.[CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER] &&
    !!props?.[CVE_ALERT_PROPS_VULNERABLE_VERSION_RANGE]
  )
}

export function isArtifactAlertUpgrade(
  alert: CompactSocketArtifactAlert
): alert is ArtifactAlertUpgrade {
  return alert.type === ALERT_TYPE_SOCKET_UPGRADE_AVAILABLE
}

export function isArtifactAlertFixable(
  alert: CompactSocketArtifactAlert
): alert is ArtifactAlertCveFixable | ArtifactAlertUpgrade {
  return isArtifactAlertUpgrade(alert) || isArtifactAlertCveFixable(alert)
}
