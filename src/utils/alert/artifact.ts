import events from 'node:events'
import https from 'node:https'
import rl from 'node:readline'

import constants from '../../constants'
import { getPublicToken } from '../sdk'

import type { IncomingMessage } from 'node:http'

export type CveAlertType = 'cve' | 'mediumCVE' | 'mildCVE' | 'criticalCVE'

export type ArtifactAlertCveFixable = Omit<
  SocketArtifactAlert,
  'props' | 'title'
> & {
  type: CveAlertType
  props: {
    firstPatchedVersionIdentifier: string
    vulnerableVersionRange: string
    [key: string]: any
  }
}

export type ArtifactAlertFixable = ArtifactAlertCveFixable & {
  type: CveAlertType | 'socketUpgradeAvailable'
}

export type SocketArtifactAlert = {
  key: string
  type: string
  severity: string
  category: string
  action?: string
  actionPolicyIndex?: number
  file?: string
  props?: any
  start?: number
  end?: number
}

export type SocketArtifact = {
  type: string
  name: string
  namespace?: string
  version?: string
  subpath?: string
  release?: string
  id?: string
  author?: string[]
  license?: string
  licenseDetails?: {
    spdxDisj: string
    provenance: string
    filepath: string
    match_strength: number
  }[]
  licenseAttrib?: {
    attribText: string
    attribData: {
      purl: string
      foundInFilepath: string
      spdxExpr: string
      foundAuthors: string[]
    }[]
  }[]
  score?: {
    supplyChain: number
    quality: number
    maintenance: number
    vulnerability: number
    license: number
    overall: number
  }
  alerts?: SocketArtifactAlert[]
  size?: number
  batchIndex?: number
}

const {
  ALERT_TYPE_CRITICAL_CVE,
  ALERT_TYPE_CVE,
  ALERT_TYPE_MEDIUM_CVE,
  ALERT_TYPE_MILD_CVE,
  ALERT_TYPE_SOCKET_UPGRADE_AVAILABLE,
  API_V0_URL,
  CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER,
  CVE_ALERT_PROPS_VULNERABLE_VERSION_RANGE,
  abortSignal
} = constants

export async function* batchScan(
  pkgIds: string[]
): AsyncGenerator<SocketArtifact> {
  const req = https
    .request(`${API_V0_URL}/purl?alerts=true`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${getPublicToken()}:`).toString('base64url')}`
      },
      signal: abortSignal
    })
    .end(
      JSON.stringify({
        components: pkgIds.map(id => ({ purl: `pkg:npm/${id}` }))
      })
    )
  const { 0: res } = <[IncomingMessage]>(
    await events.once(req, 'response', { signal: abortSignal })
  )
  const ok = res.statusCode! >= 200 && res.statusCode! <= 299
  if (!ok) {
    throw new Error(`Socket API Error: ${res.statusCode}`)
  }
  const rli = rl.createInterface(res)
  for await (const line of rli) {
    yield JSON.parse(line)
  }
}

export function isArtifactAlertCveFixable(
  alert: SocketArtifactAlert
): alert is ArtifactAlertCveFixable {
  const { type } = alert
  return (
    (type === ALERT_TYPE_CVE ||
      type === ALERT_TYPE_MEDIUM_CVE ||
      type === ALERT_TYPE_MILD_CVE ||
      type === ALERT_TYPE_CRITICAL_CVE) &&
    !!alert.props?.[CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER] &&
    !!alert.props?.[CVE_ALERT_PROPS_VULNERABLE_VERSION_RANGE]
  )
}

export function isArtifactAlertUpgradeFixable(
  alert: SocketArtifactAlert
): alert is ArtifactAlertFixable {
  return alert.type === ALERT_TYPE_SOCKET_UPGRADE_AVAILABLE
}

export function isArtifactAlertFixable(
  alert: SocketArtifactAlert
): alert is ArtifactAlertFixable {
  return (
    isArtifactAlertUpgradeFixable(alert) || isArtifactAlertCveFixable(alert)
  )
}
