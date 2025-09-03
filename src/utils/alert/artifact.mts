import constants from '../../constants.mts'

import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { components, operations } from '@socketsecurity/sdk/types/api'

export type ALERT_ACTION = 'error' | 'monitor' | 'warn' | 'ignore'

export type ALERT_TYPE = keyof NonNullable<
  operations['getOrgSecurityPolicy']['responses']['200']['content']['application/json']['securityPolicyRules']
>

export type CVE_ALERT_TYPE = 'cve' | 'mediumCVE' | 'mildCVE' | 'criticalCVE'

export type ArtifactAlertCve = Remap<
  Omit<CompactSocketArtifactAlert, 'type'> & {
    type: CVE_ALERT_TYPE
  }
>

export type ArtifactAlertCveFixable = Remap<
  Omit<CompactSocketArtifactAlert, 'props' | 'type'> & {
    type: CVE_ALERT_TYPE
    props: CveProps
  }
>

export type ArtifactAlertUpgrade = Remap<
  Omit<CompactSocketArtifactAlert, 'type'> & {
    type: 'socketUpgradeAvailable'
  }
>

export type CompactSocketArtifactAlert = Remap<
  Omit<SocketArtifactAlert, 'category' | 'end' | 'file' | 'severity' | 'start'>
>

export type CompactSocketArtifact = Remap<
  Omit<SocketArtifact, 'alerts' | 'batchIndex' | 'size'> & {
    alerts: CompactSocketArtifactAlert[]
  }
>

export type CveProps = {
  firstPatchedVersionIdentifier?: string
  vulnerableVersionRange: string
  [key: string]: any
}

export type SocketArtifact = Remap<
  Omit<components['schemas']['SocketArtifact'], 'alerts'> & {
    alerts?: SocketArtifactAlert[]
  }
>

export type SocketArtifactAlert = Remap<
  Omit<components['schemas']['SocketAlert'], 'action' | 'props' | 'type'> & {
    type: ALERT_TYPE
    action?: ALERT_ACTION
    props?: any | undefined
  }
>

export function isArtifactAlertCve(
  alert: CompactSocketArtifactAlert,
): alert is ArtifactAlertCve {
  const { type } = alert
  return (
    type === constants.ALERT_TYPE_CVE ||
    type === constants.ALERT_TYPE_MEDIUM_CVE ||
    type === constants.ALERT_TYPE_MILD_CVE ||
    type === constants.ALERT_TYPE_CRITICAL_CVE
  )
}
