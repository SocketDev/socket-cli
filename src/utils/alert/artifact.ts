import events from 'node:events'
import https from 'node:https'
import rl from 'node:readline'

import constants from '../../constants'
import { getPublicToken } from '../sdk'

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
  namespace?: string
  name?: string
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

const { API_V0_URL, abortSignal } = constants

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
  const { 0: res } = await events.once(req, 'response')
  const ok = res.statusCode >= 200 && res.statusCode <= 299
  if (!ok) {
    throw new Error(`Socket API Error: ${res.statusCode}`)
  }
  const rli = rl.createInterface(res)
  for await (const line of rli) {
    yield JSON.parse(line)
  }
}

export function isArtifactAlertCveFixable(alert: SocketArtifactAlert): boolean {
  const { type } = alert
  return (
    (type === 'cve' ||
      type === 'mediumCVE' ||
      type === 'mildCVE' ||
      type === 'criticalCVE') &&
    !!alert.props?.['firstPatchedVersionIdentifier']
  )
}

export function isArtifactAlertFixable(alert: SocketArtifactAlert): boolean {
  return (
    alert.type === 'socketUpgradeAvailable' || isArtifactAlertCveFixable(alert)
  )
}
