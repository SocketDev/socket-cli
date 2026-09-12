import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { HttpsProxyAgent } from 'hpagent'

import {
  addFirewallRegistryArgument,
  isFirewallRebindCommand,
  validateFirewallRebindConfig,
} from './rebind-config.mts'
import {
  firewallRebindTarget,
  rewriteFirewallRegistryMetadata,
} from './rebind-metadata.mts'

import type { Socket } from 'node:net'
import type { FirewallEnvironment } from './environment.mts'

export function firewallRebindResponseStatus(status: number): number {
  return status >= 300 && status < 400 ? 502 : status
}

export async function handleFirewallRebindRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  config: {
    agent: HttpsProxyAgent
    certificate: string
    signal: AbortSignal
    targets: Map<string, URL>
    origin: string
    prefix: string
  },
): Promise<void> {
  const opts = { __proto__: null, ...config } as typeof config
  const requestPath = request.url ?? ''
  const prefix = `/${opts.prefix}/`
  if (
    request.headers.host !== new URL(opts.origin).host ||
    !requestPath.startsWith(prefix) ||
    !['GET', 'HEAD'].includes(request.method ?? '')
  ) {
    response.writeHead(403).end()
    return
  }
  const suffix = requestPath.slice(prefix.length)
  const target = suffix.startsWith('artifact/')
    ? opts.targets.get(suffix)
    : firewallRebindTarget(`/${suffix}`)
  if (!target) {
    response.writeHead(404).end()
    return
  }
  const upstream = await new Promise<http.IncomingMessage>(
    (resolve, reject) => {
      const outgoing = https.request(
        target,
        {
          agent: opts.agent,
          ca: opts.certificate,
          rejectUnauthorized: true,
          method: request.method,
          headers: {
            accept: 'application/json',
            'accept-encoding': 'identity',
          },
          signal: opts.signal,
          timeout: 30_000,
        },
        resolve,
      )
      outgoing.once('error', reject)
      outgoing.once('timeout', () =>
        outgoing.destroy(new Error('vlt registry request timed out')),
      )
      outgoing.end()
    },
  )
  response.once('close', () => upstream.destroy())
  const status = upstream.statusCode ?? 502
  if (status !== 200) {
    upstream.destroy()
    response.writeHead(firewallRebindResponseStatus(status)).end()
    return
  }
  if (target.pathname.endsWith('.tgz') || request.method === 'HEAD') {
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    await pipeline(upstream, response)
    return
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of upstream) {
    const buffer = Buffer.from(chunk)
    length += buffer.length
    if (length > 16_777_216) {
      throw new Error('vlt registry metadata exceeds the supported size')
    }
    chunks.push(buffer)
  }
  const metadata: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  rewriteFirewallRegistryMetadata(metadata, artifactTarget => {
    if (opts.targets.size >= 100_000) {
      throw new Error('vlt registry artifact limit exceeded')
    }
    const id = `artifact/${crypto.randomBytes(24).toString('hex')}`
    opts.targets.set(id, artifactTarget)
    return `${opts.origin}${prefix}${id}`
  })
  response
    .writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify(metadata))
}

export async function startFirewallRegistryRebind(config: {
  command: string
  args: readonly string[]
  cwd?: string | undefined
  env: FirewallEnvironment
  proxyUrl: string
  certificate: string
}): Promise<{ args: string[]; close: () => Promise<void> } | undefined> {
  const opts = { __proto__: null, ...config } as typeof config
  if (!isFirewallRebindCommand(opts.command)) {
    return undefined
  }
  await validateFirewallRebindConfig(config)
  const agent = new HttpsProxyAgent({
    proxy: opts.proxyUrl,
    keepAlive: true,
  })
  const sockets = new Set<Socket>()
  const controller = new AbortController()
  const targets = new Map<string, URL>()
  const prefix = crypto.randomBytes(24).toString('hex')
  let origin = ''
  let closed = false
  const server = http.createServer((request, response) => {
    void handleFirewallRebindRequest(request, response, {
      agent,
      certificate: opts.certificate,
      signal: controller.signal,
      targets,
      origin,
      prefix,
    }).catch(() => {
      if (response.headersSent) {
        response.destroy()
      } else {
        response.writeHead(502).end()
      }
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  } catch (error) {
    agent.destroy()
    throw error
  }
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing vlt adapter address')
  }
  origin = `http://127.0.0.1:${address.port}`
  return {
    args: addFirewallRegistryArgument(opts.args, `${origin}/${prefix}/`),
    async close() {
      if (closed) {
        return
      }
      closed = true
      controller.abort()
      agent.destroy()
      for (const socket of sockets) {
        socket.destroy()
      }
      targets.clear()
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      )
    },
  }
}
