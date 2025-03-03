import events from 'node:events'
import https from 'node:https'
import readline from 'node:readline'

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
  action?: string | undefined
  actionPolicyIndex?: number | undefined
  file?: string | undefined
  props?: any | undefined
  start?: number | undefined
  end?: number | undefined
}

export type SocketArtifact = {
  type: string
  name: string
  namespace?: string | undefined
  version?: string | undefined
  subpath?: string | undefined
  release?: string | undefined
  id?: string | undefined
  author?: string[]
  license?: string | undefined
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
  size?: number | undefined
  batchIndex?: number | undefined
}

const {
  ALERT_TYPE_CRITICAL_CVE,
  ALERT_TYPE_CVE,
  ALERT_TYPE_MEDIUM_CVE,
  ALERT_TYPE_MILD_CVE,
  ALERT_TYPE_SOCKET_UPGRADE_AVAILABLE,
  CVE_ALERT_PROPS_FIRST_PATCHED_VERSION_IDENTIFIER,
  CVE_ALERT_PROPS_VULNERABLE_VERSION_RANGE,
  abortSignal
} = constants

async function* createBatchGenerator(
  chunk: string[]
): AsyncGenerator<SocketArtifact> {
  // Adds the first 'abort' listener to abortSignal.
  const req = https
    // Lazily access constants.BATCH_PURL_ENDPOINT.
    .request(constants.BATCH_PURL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${getPublicToken()}:`)}`
      },
      signal: abortSignal
    })
    .end(
      JSON.stringify({
        components: chunk.map(id => ({ purl: `pkg:npm/${id}` }))
      })
    )
  // Adds the second 'abort' listener to abortSignal.
  const { 0: res } = <[IncomingMessage]>(
    await events.once(req, 'response', { signal: abortSignal })
  )
  const ok = res.statusCode! >= 200 && res.statusCode! <= 299
  if (!ok) {
    throw new Error(`Socket API Error: ${res.statusCode}`)
  }
  const rli = readline.createInterface({
    input: res,
    crlfDelay: Infinity,
    signal: abortSignal
  })
  for await (const line of rli) {
    yield <SocketArtifact>JSON.parse(line)
  }
}

export async function* batchScan(
  pkgIds: string[],
  concurrencyLimit = 50
): AsyncGenerator<SocketArtifact> {
  type GeneratorStep = {
    generator: AsyncGenerator<SocketArtifact>
    iteratorResult: IteratorResult<SocketArtifact>
  }
  type GeneratorEntry = {
    generator: AsyncGenerator<SocketArtifact>
    promise: Promise<GeneratorStep>
  }
  type ResolveFn = (value: GeneratorStep) => void

  // The createBatchGenerator method will add 2 'abort' event listeners to
  // abortSignal so we multiply the concurrencyLimit by 2.
  const neededMaxListeners = concurrencyLimit * 2
  // Increase abortSignal max listeners count to avoid Node's MaxListenersExceededWarning.
  const oldAbortSignalMaxListeners = events.getMaxListeners(abortSignal)
  let abortSignalMaxListeners = oldAbortSignalMaxListeners
  if (oldAbortSignalMaxListeners < neededMaxListeners) {
    abortSignalMaxListeners = oldAbortSignalMaxListeners + neededMaxListeners
    events.setMaxListeners(abortSignalMaxListeners, abortSignal)
  }
  const { length: pkgIdsCount } = pkgIds
  const running: GeneratorEntry[] = []
  let index = 0
  const enqueueGen = () => {
    if (index >= pkgIdsCount) {
      // No more work to do.
      return
    }
    const chunk = pkgIds.slice(index, index + 25)
    index += 25
    const generator = createBatchGenerator(chunk)
    continueGen(generator)
  }
  const continueGen = (generator: AsyncGenerator<SocketArtifact>) => {
    let resolveFn: ResolveFn
    running.push({
      generator,
      promise: new Promise<GeneratorStep>(resolve => (resolveFn = resolve))
    })
    void generator
      .next()
      .then(res => resolveFn!({ generator, iteratorResult: res }))
  }
  // Start initial batch of generators.
  while (running.length < concurrencyLimit && index < pkgIdsCount) {
    enqueueGen()
  }
  while (running.length > 0) {
    // eslint-disable-next-line no-await-in-loop
    const { generator, iteratorResult } = await Promise.race(
      running.map(entry => entry.promise)
    )
    // Remove generator.
    running.splice(
      running.findIndex(entry => entry.generator === generator),
      1
    )
    if (iteratorResult.done) {
      // Start a new generator if available.
      enqueueGen()
    } else {
      yield iteratorResult.value
      // Keep fetching values from this generator.
      continueGen(generator)
    }
  }
  // Reset abortSignal max listeners count.
  if (abortSignalMaxListeners > oldAbortSignalMaxListeners) {
    events.setMaxListeners(oldAbortSignalMaxListeners, abortSignal)
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
