/**
 * @file Socket artifact and alert type definitions.
 */

import type {
  ALERT_ACTION,
  ALERT_TYPE,
  CompactSocketArtifact,
  CompactSocketArtifactAlert,
  SocketArtifact,
  SocketArtifactAlert,
} from '@socketsecurity/sdk-stable'

export type {
  ALERT_ACTION,
  ALERT_TYPE,
  CompactSocketArtifact,
  CompactSocketArtifactAlert,
  SocketArtifact,
  SocketArtifactAlert,
}

export type CveProps = {
  firstPatchedVersionIdentifier?: string | undefined
  vulnerableVersionRange: string
  [key: string]: unknown
}
