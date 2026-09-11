import http from 'node:http'
import https from 'node:https'
import { connect, isIP } from 'node:net'
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'
import { createSecureContext, rootCertificates, TLSSocket } from 'node:tls'

import { formatFirewallError } from './proxy-errors.mts'

import type { Duplex } from 'node:stream'
import type { FirewallCertificateAuthority } from './certificates.mts'

export type FirewallProxyConfig = {
  certificateAuthority: FirewallCertificateAuthority
  checkRequest: (
    url: URL,
    method: string,
  ) => Promise<{ blocked: boolean; reasons?: string[] | undefined }>
  upstreamCa?: string[] | undefined
  upstreamProxy?: string | undefined
  resolveDestination?:
    | ((url: URL) => 'inspect' | 'bypass' | 'block')
    | undefined
  timeoutMs?: number | undefined
  onRequestError?: ((diagnostic: string) => void) | undefined
}

export function firewallProxyHeaders(
  headers: http.IncomingHttpHeaders,
): http.OutgoingHttpHeaders {
  const result = { ...headers }
  const connection = String(headers.connection ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
  for (const name of [
    'connection',
    'proxy-connection',
    'proxy-authorization',
    'proxy-authenticate',
    'keep-alive',
    'transfer-encoding',
    'te',
    'trailer',
    'upgrade',
    ...connection,
  ]) {
    delete result[name]
  }
  return result
}

export function firewallProxyTarget(
  request: http.IncomingMessage,
  tunnel?: URL | undefined,
): URL | undefined {
  const raw = request.url ?? ''
  const target = tunnel ? new URL(raw, tunnel) : new URL(raw)
  if (
    target.username ||
    target.password ||
    target.hash ||
    (tunnel ? target.origin !== tunnel.origin : target.protocol !== 'http:') ||
    !request.headers.host ||
    new URL(`${target.protocol}//${request.headers.host}`).host !== target.host
  ) {
    return undefined
  }
  return target
}

export async function startFirewallProxy(config: FirewallProxyConfig): Promise<{
  url: string
  close: () => Promise<void>
}> {
  const opts = { __proto__: null, ...config } as typeof config
  const timeoutMs = opts.timeoutMs ?? 30_000
  const sockets = new Set<Duplex>()
  const outgoing = new Set<http.ClientRequest>()
  const tunnels = new Map<Duplex, URL>()
  let closed = false
  const proxyUrl = opts.upstreamProxy ? new URL(opts.upstreamProxy) : undefined
  if (proxyUrl && !['http:', 'https:'].includes(proxyUrl.protocol)) {
    throw new Error('Unsupported upstream proxy protocol')
  }
  const upstreamCa = opts.upstreamCa?.length
    ? [...rootCertificates, ...opts.upstreamCa]
    : undefined
  const proxyController = new AbortController()
  const proxyRequestOptions = {
    ...(upstreamCa ? { ca: upstreamCa } : {}),
    rejectUnauthorized: true,
    signal: proxyController.signal,
  }
  const httpAgent = proxyUrl
    ? new HttpProxyAgent({ proxy: proxyUrl, proxyRequestOptions })
    : undefined
  const httpsAgent = proxyUrl
    ? new HttpsProxyAgent({ proxy: proxyUrl, proxyRequestOptions })
    : undefined
  const server = http.createServer()
  const decrypted = http.createServer()

  function report(error: unknown) {
    if (!closed) {
      try {
        opts.onRequestError?.(formatFirewallError(error))
      } catch {}
    }
  }

  function track(socket: Duplex) {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
  }

  function reject(response: http.ServerResponse, status: number) {
    if (response.headersSent) {
      response.destroy()
    } else {
      response.writeHead(status, {
        connection: 'close',
        'content-type': 'text/plain',
      })
      response.end('Firewall request rejected.\n')
    }
  }

  async function handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    request.pause()
    request.on('error', () => response.destroy())
    response.on('error', () => request.destroy())
    const deadline = setTimeout(() => {
      reject(response, 504)
    }, timeoutMs)
    response.once('close', () => clearTimeout(deadline))
    try {
      const tunnel = tunnels.get(request.socket)
      if (
        !['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'].includes(
          request.method ?? '',
        )
      ) {
        reject(response, 405)
        return
      }
      const target = firewallProxyTarget(request, tunnel)
      if (!target) {
        reject(response, 400)
        return
      }
      const decision = await opts.checkRequest(target, request.method ?? 'GET')
      if (closed || response.destroyed || response.writableEnded) {
        return
      }
      if (decision.blocked) {
        reject(response, 403)
        return
      }
      const headers = firewallProxyHeaders(request.headers)
      headers.host = target.host
      const client = target.protocol === 'https:' ? https : http
      const upstream = client.request(
        target,
        {
          method: request.method,
          headers,
          agent:
            (target.protocol === 'https:' ? httpsAgent : httpAgent) ?? false,
          timeout: timeoutMs,
          ...(target.protocol === 'https:'
            ? { ca: upstreamCa, rejectUnauthorized: true }
            : {}),
        },
        incoming => {
          if (closed || response.destroyed || response.writableEnded) {
            incoming.destroy()
            return
          }
          response.writeHead(
            incoming.statusCode ?? 502,
            firewallProxyHeaders(incoming.headers),
          )
          incoming.on('error', () => response.destroy())
          incoming.pipe(response)
        },
      )
      outgoing.add(upstream)
      upstream.once('close', () => outgoing.delete(upstream))
      upstream.on('timeout', () => upstream.destroy())
      upstream.on('error', error => {
        report(error)
        reject(response, 502)
      })
      request.on('aborted', () => upstream.destroy())
      response.once('close', () => upstream.destroy())
      request.pipe(upstream)
      request.resume()
    } catch (error) {
      report(error)
      reject(response, 502)
    }
  }

  for (const listener of [server, decrypted]) {
    listener.requestTimeout = timeoutMs
    listener.headersTimeout = timeoutMs
    listener.keepAliveTimeout = Math.min(timeoutMs, 5000)
    listener.on('request', (request, response) => {
      void handle(request, response)
    })
    listener.on('clientError', (...args) => args[1].destroy())
    listener.on('upgrade', (...args) => args[1].destroy())
  }
  server.on('connection', socket => {
    track(socket)
    socket.setTimeout(timeoutMs, () => socket.destroy())
  })
  function bypassTunnel(target: URL, socket: Duplex, head: Buffer) {
    function ready(remote: Duplex) {
      if (closed || socket.destroyed) {
        remote.destroy()
        return
      }
      track(remote)
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) {
        remote.write(head)
      }
      socket.pipe(remote).pipe(socket)
      socket.once('close', () => remote.destroy())
      remote.once('close', () => socket.destroy())
    }
    const hostname = target.hostname.replace(/^\[|\]$/g, '')
    if (!proxyUrl) {
      const remote = connect({
        host: hostname,
        port: Number(target.port || 443),
        timeout: timeoutMs,
      })
      track(remote)
      remote.on('timeout', () => remote.destroy())
      remote.on('error', error => {
        report(error)
        socket.destroy()
      })
      socket.once('close', () => remote.destroy())
      remote.once('connect', () => ready(remote))
      return
    }
    const headers: http.OutgoingHttpHeaders = { host: target.host }
    if (proxyUrl.username || proxyUrl.password) {
      headers['proxy-authorization'] =
        `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}`
    }
    const transport = proxyUrl.protocol === 'https:' ? https : http
    const request = transport.request(proxyUrl, {
      method: 'CONNECT',
      path: `${target.hostname}:${target.port || 443}`,
      headers,
      agent: false,
      timeout: timeoutMs,
      ...(proxyUrl.protocol === 'https:'
        ? { ca: upstreamCa, rejectUnauthorized: true }
        : {}),
    })
    outgoing.add(request)
    request.once('close', () => outgoing.delete(request))
    request.on('error', error => {
      report(error)
      socket.destroy()
    })
    request.on('timeout', () => request.destroy())
    socket.once('close', () => request.destroy())
    request.on('response', response => {
      response.destroy()
      socket.destroy()
    })
    request.on('connect', (response, remote, buffered) => {
      if (response.statusCode !== 200) {
        remote.destroy()
        socket.destroy()
        return
      }
      if (buffered.length) {
        remote.unshift(buffered)
      }
      ready(remote)
    })
    request.end()
  }
  server.on('connect', (request, socket, head) => {
    try {
      const authority = request.url ?? ''
      const target = new URL(`https://${authority}`)
      if (
        !/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\]):[0-9]+$/i.test(authority) ||
        target.pathname !== '/' ||
        target.search ||
        target.hash ||
        target.username ||
        target.password
      ) {
        socket.destroy()
        return
      }
      const disposition = opts.resolveDestination?.(target) ?? 'inspect'
      if (disposition === 'block') {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      if (disposition === 'bypass') {
        bypassTunnel(target, socket, head)
        return
      }
      const hostname = target.hostname.replace(/^\[|\]$/g, '')
      const material = opts.certificateAuthority.issue(hostname)
      const context = createSecureContext(material)
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) {
        socket.unshift(head)
      }
      const secure = new TLSSocket(socket, {
        isServer: true,
        secureContext: context,
        ALPNProtocols: ['http/1.1'],
        SNICallback(servername, callback) {
          let error: Error | null = null
          if (
            servername.toLowerCase() !== hostname.toLowerCase() ||
            isIP(servername)
          ) {
            error = new Error('Firewall tunnel identity mismatch')
          }
          callback(error, context)
        },
      })
      track(secure)
      secure.setTimeout(timeoutMs, () => secure.destroy())
      tunnels.set(secure, target)
      secure.once('close', () => tunnels.delete(secure))
      decrypted.emit('connection', secure)
    } catch (error) {
      report(error)
      socket.destroy()
    }
  })
  decrypted.on('connect', (...args) => args[1].destroy())
  await new Promise<void>((resolve, rejectStart) => {
    server.once('error', rejectStart)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', rejectStart)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Firewall listener address unavailable')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) {
        return
      }
      closed = true
      proxyController.abort()
      httpAgent?.destroy()
      httpsAgent?.destroy()
      for (const request of outgoing) {
        request.destroy()
      }
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
