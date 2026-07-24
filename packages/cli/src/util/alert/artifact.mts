/**
 * @file Socket artifact and alert type definitions. Derived from the SDK's raw
 *   OpenAPI schema (`@socketsecurity/sdk-stable/types/api`) rather than the
 *   `@socketsecurity/sdk-stable` root export: the SDK's `dist/types.d.mts`
 *   imports `../types/api` without a file extension, which TypeScript's
 *   nodenext resolution cannot resolve, so the root export's artifact types
 *   silently collapse to index-signature-over-`any` blobs (every property
 *   access then trips TS4111 under `noPropertyAccessFromIndexSignature`).
 *   The definitions below mirror the SDK's shapes one-to-one against the
 *   schema import that DOES resolve.
 */

import type {
  components,
  operations,
} from '@socketsecurity/sdk-stable/types/api'

export type ALERT_ACTION = 'error' | 'monitor' | 'warn' | 'ignore'

export type ALERT_TYPE = keyof NonNullable<
  operations['getOrgSecurityPolicy']['responses']['200']['content']['application/json']['securityPolicyRules']
>

export type SocketArtifactAlert = Omit<
  components['schemas']['SocketAlert'],
  'action' | 'props' | 'type'
> & {
  type: ALERT_TYPE
  action?: ALERT_ACTION | undefined
  props?: Record<string, unknown> | undefined
}

export type SocketArtifact = Omit<
  components['schemas']['SocketArtifact'],
  'alerts'
> & {
  alerts?: SocketArtifactAlert[] | undefined
}

export type CompactSocketArtifactAlert = Omit<
  SocketArtifactAlert,
  'actionSource' | 'category' | 'end' | 'file' | 'start'
>

export type CompactSocketArtifact = Omit<
  SocketArtifact,
  | 'alerts'
  | 'alertKeysToReachabilitySummaries'
  | 'alertKeysToReachabilityTypes'
  | 'artifact'
  | 'batchIndex'
  | 'dead'
  | 'dependencies'
  | 'dev'
  | 'direct'
  | 'inputPurl'
  | 'manifestFiles'
  | 'score'
  | 'size'
  | 'topLevelAncestors'
> & {
  alerts: CompactSocketArtifactAlert[]
}

export type CveProps = {
  firstPatchedVersionIdentifier?: string | undefined
  vulnerableVersionRange: string
  [key: string]: unknown
}
