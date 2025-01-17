import events from 'node:events'
import https from 'node:https'
import rl from 'node:readline'

import constants from '../../../../constants'
import { getPublicToken } from '../../../../utils/sdk'

import type { SafeNode } from '../node'
import type { Diff } from '@npmcli/arborist'

export type InstallEffect = {
  pkgid: SafeNode['pkgid']
  repository_url: string
  existing?: SafeNode['pkgid'] | undefined
}

export type SocketAlert = {
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
  alerts?: SocketAlert[]
  size?: number
  batchIndex?: number
}

const {
  API_V0_URL,
  LOOP_SENTINEL,
  SOCKET_CLI_FIX_PACKAGE_LOCK_FILE,
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

export function isAlertFixable(alert: SocketAlert): boolean {
  return alert.type === 'socketUpgradeAvailable' || isAlertFixableCve(alert)
}

export function isAlertFixableCve(alert: SocketAlert): boolean {
  const { type } = alert
  return (
    (type === 'cve' ||
      type === 'mediumCVE' ||
      type === 'mildCVE' ||
      type === 'criticalCVE') &&
    !!alert.props?.['firstPatchedVersionIdentifier']
  )
}

function toRepoUrl(resolved: string): string {
  try {
    return URL.parse(resolved)?.origin ?? ''
  } catch {}
  return ''
}

export type WalkOptions = { fix?: boolean }

export function walk(
  diff_: Diff | null,
  options?: WalkOptions
): InstallEffect[] {
  const {
    // Lazily access constants.IPC.
    fix = constants.IPC[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]
  } = <WalkOptions>{
    __proto__: null,
    ...options
  }
  const needInfoOn: InstallEffect[] = []
  // `diff_` is `null` when `npm install --package-lock-only` is passed.
  if (!diff_) {
    return needInfoOn
  }
  const queue: Diff[] = [...diff_.children]
  let pos = 0
  let { length: queueLength } = queue
  while (pos < queueLength) {
    if (pos === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop while walking Arborist diff')
    }
    const diff = queue[pos++]!
    const { action } = diff
    if (action) {
      // The `pkgNode`, i.e. the `ideal` node, will be `undefined` if the diff
      // action is 'REMOVE'
      // The `oldNode`, i.e. the `actual` node, will be `undefined` if the diff
      // action is 'ADD'.
      const { actual: oldNode, ideal: pkgNode } = diff
      let existing
      let keep = false
      if (action === 'CHANGE') {
        if (pkgNode?.package.version !== oldNode?.package.version) {
          keep = true
          if (
            oldNode?.package.name &&
            oldNode.package.name === pkgNode?.package.name
          ) {
            existing = oldNode.pkgid
          }
        } else {
          // TODO: Add proper debug mode.
          // console.warn('SKIPPING META CHANGE ON', diff)
        }
      } else {
        keep = action !== 'REMOVE'
      }
      if (keep && pkgNode?.resolved && (!oldNode || oldNode.resolved)) {
        needInfoOn.push({
          existing,
          pkgid: pkgNode.pkgid,
          repository_url: toRepoUrl(pkgNode.resolved)
        })
      }
    }
    for (const child of diff.children) {
      queue[queueLength++] = child
    }
  }
  if (fix) {
    const { unchanged } = diff_!
    for (let i = 0, { length } = unchanged; i < length; i += 1) {
      const pkgNode = unchanged[i]!
      needInfoOn.push({
        existing: pkgNode.pkgid,
        pkgid: pkgNode.pkgid,
        repository_url: toRepoUrl(pkgNode.resolved!)
      })
    }
  }
  return needInfoOn
}
