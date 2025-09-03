import constants from '../../constants.mts'

import type { Remap } from '@socketsecurity/registry/lib/objects'
import type {
  ALERT_ACTION,
  ALERT_TYPE,
  CompactSocketArtifact,
  CompactSocketArtifactAlert,
  SocketArtifact,
  SocketArtifactAlert,
} from '@socketsecurity/sdk'

export type {
  ALERT_ACTION,
  ALERT_TYPE,
  CompactSocketArtifact,
  CompactSocketArtifactAlert,
  SocketArtifact,
  SocketArtifactAlert,
}

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

export type CveProps = {
  firstPatchedVersionIdentifier?: string
  vulnerableVersionRange: string
  [key: string]: any
}

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
