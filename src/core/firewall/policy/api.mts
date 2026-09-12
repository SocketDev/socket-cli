import https from 'node:https'
import { HttpsProxyAgent } from 'hpagent'
import { PackageURL } from '@socketregistry/packageurl-js-stable'

import type { FirewallDecision, FirewallPolicyOptions } from './types.mts'

export function assertFirewallArtifactFields(
  artifact: object,
): asserts artifact is { name: string; type: string; version: string } {
  if (
    !('name' in artifact) ||
    typeof artifact.name !== 'string' ||
    !('type' in artifact) ||
    typeof artifact.type !== 'string' ||
    !('version' in artifact) ||
    typeof artifact.version !== 'string'
  ) {
    throw new Error('Firewall API returned a malformed artifact.')
  }
}

export function createFirewallApiError(
  status?: number | undefined,
): Error & { code: string } {
  return Object.assign(new Error('Firewall API request failed.'), {
    code:
      status === 401 || status === 403
        ? 'ERR_FIREWALL_API_AUTH'
        : 'ERR_FIREWALL_API_REQUEST',
  })
}

export async function fetchFirewallDecision(
  purl: string,
  config: FirewallPolicyOptions,
  signal: AbortSignal,
): Promise<FirewallDecision> {
  const opts = { __proto__: null, ...config } as typeof config
  const token =
    opts.apiToken && opts.apiToken !== 'sfw_free' ? opts.apiToken : undefined
  const url = token
    ? 'https://api.socket.dev/v0/purl?alerts=true'
    : `https://firewall-api.socket.dev/purl/${encodeURIComponent(purl)}`
  const init: RequestInit = {
    method: token ? 'POST' : 'GET',
    headers: token
      ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
      : {},
    ...(token ? { body: JSON.stringify({ components: [{ purl }] }) } : {}),
    redirect: 'error',
    signal,
  }
  const response = opts.fetch
    ? await opts.fetch(url, init)
    : await fetchFirewallTransport(
        url,
        init,
        opts.upstreamProxy,
        opts.upstreamCa,
      )
  return parseFirewallApiDecision(await readFirewallApiResponse(response), purl)
}

export function fetchFirewallTransport(
  url: string,
  init: RequestInit,
  proxy: string | undefined,
  ca?: string[] | undefined,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const agent = proxy
      ? new HttpsProxyAgent({
          proxy,
          rejectUnauthorized: true,
          ...(ca ? { ca } : {}),
          proxyRequestOptions: {
            rejectUnauthorized: true,
            ...(ca ? { ca } : {}),
            ...(init.signal ? { signal: init.signal } : {}),
          },
        })
      : new https.Agent({ ...(ca ? { ca } : {}), rejectUnauthorized: true })
    const request = https.request(
      url,
      {
        agent,
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers)),
        signal: init.signal ?? undefined,
      },
      response => {
        if (response.statusCode !== 200) {
          response.destroy()
          agent.destroy()
          reject(createFirewallApiError(response.statusCode))
          return
        }
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 4 * 1024 * 1024) {
            request.destroy(
              new Error('Firewall API response exceeds the size limit.'),
            )
          } else {
            chunks.push(chunk)
          }
        })
        response.on('error', error => {
          agent.destroy()
          reject(error)
        })
        response.on('end', () => {
          agent.destroy()
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 502,
            }),
          )
        })
      },
    )
    request.on('error', error => {
      agent.destroy()
      reject(error)
    })
    request.end(init.body)
  })
}

export function firewallApiPackageIdentity(artifact: {
  name: string
  type: string
  version: string
}): PackageURL {
  const separator = artifact.name.lastIndexOf('/')
  const namespace =
    'namespace' in artifact && typeof artifact.namespace === 'string'
      ? artifact.namespace
      : undefined
  return new PackageURL(
    artifact.type,
    namespace ??
      (separator < 0 ? undefined : artifact.name.slice(0, separator)),
    namespace || separator < 0
      ? artifact.name
      : artifact.name.slice(separator + 1),
    artifact.version,
    undefined,
    undefined,
  )
}

export function parseFirewallAlertDecision(alert: unknown): FirewallDecision {
  if (
    !alert ||
    typeof alert !== 'object' ||
    !('type' in alert) ||
    typeof alert.type !== 'string' ||
    ('action' in alert && typeof alert.action !== 'string')
  ) {
    throw new Error('Firewall API returned a malformed alert.')
  }
  const action = 'action' in alert ? alert.action : undefined
  return {
    blocked: action === 'error',
    reasons:
      action === 'error' || action === 'warn'
        ? [`${action}: ${alert.type}`]
        : [],
  }
}

export function parseFirewallApiDecision(
  body: string,
  purl: string,
): FirewallDecision {
  const lines = body.split(/\r?\n/).filter(line => line.trim())
  if (!lines.length) {
    throw new Error('Firewall API returned an empty result.')
  }
  const decisions = lines.map(line =>
    parseFirewallArtifactDecision(JSON.parse(line), purl),
  )
  return {
    blocked: decisions.some(decision => decision.blocked),
    reasons: decisions.flatMap(decision => decision.reasons ?? []),
  }
}

export function parseFirewallArtifactDecision(
  artifact: unknown,
  purl: string,
): FirewallDecision {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('Firewall API returned a malformed artifact.')
  }
  validateFirewallArtifactIdentity(artifact, purl)
  if (!('alerts' in artifact)) {
    if (
      'id' in artifact &&
      typeof artifact.id === 'string' &&
      artifact.id.startsWith('synthetic:notFound:')
    ) {
      return { blocked: false }
    }
    throw new Error('Firewall API returned no alert evaluation.')
  }
  if (!Array.isArray(artifact.alerts)) {
    throw new Error('Firewall API returned malformed alerts.')
  }
  const decisions = (artifact.alerts as unknown[]).map(
    parseFirewallAlertDecision,
  )
  return {
    blocked: decisions.some(decision => decision.blocked),
    reasons: decisions.flatMap(decision => decision.reasons ?? []),
  }
}

export async function readFirewallApiResponse(
  response: Response,
): Promise<string> {
  if (!response.ok || !response.body) {
    throw createFirewallApiError(response.status)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) {
        break
      }
      bytes += result.value.length
      if (bytes > 4 * 1024 * 1024) {
        throw new Error('Firewall API response exceeds the size limit.')
      }
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function validateFirewallArtifactIdentity(
  artifact: object,
  purl: string,
): void {
  assertFirewallArtifactFields(artifact)
  const wanted = PackageURL.fromString(purl)
  if ('inputPurl' in artifact) {
    if (
      typeof artifact.inputPurl !== 'string' ||
      PackageURL.fromString(artifact.inputPurl).toString() !== wanted.toString()
    ) {
      throw new Error('Firewall API returned a different package.')
    }
  }
  const actual = firewallApiPackageIdentity(artifact)
  if (
    actual.type !== wanted.type ||
    actual.namespace !== wanted.namespace ||
    actual.name !== wanted.name ||
    actual.version !== wanted.version
  ) {
    throw new Error('Firewall API returned a different package identity.')
  }
}
