import http from 'node:http'
import https from 'node:https'
import { connect } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  ensureFirewallCertificateAuthority,
  loadFirewallCertificateAuthority,
} from '../../../../src/util/firewall/certificates.mts'
import type { FirewallCertificateAuthority } from '../../../../src/util/firewall/certificates.mts'
import { startFirewallProxy } from '../../../../src/util/firewall/proxy.mts'
import {
  closeFirewallFixture,
  connectFirewallFixture,
  listenFirewallFixture,
  requestFirewallFixture,
  requestFirewallTunnel,
} from './proxy-fixture.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

let directory: string
let certificateAuthority: FirewallCertificateAuthority
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'firewall-proxy-'))
  certificateAuthority = await loadFirewallCertificateAuthority(
    await ensureFirewallCertificateAuthority({ directory }),
  )
})
afterAll(async () => {
  await safeDelete(directory)
})

describe('firewall proxy', () => {
  it('checks each HTTP request and removes hop and proxy credentials', async () => {
    const received: http.IncomingHttpHeaders[] = []
    const upstream = http.createServer((request, response) => {
      received.push(request.headers)
      response.end('artifact')
    })
    const port = await listenFirewallFixture(upstream)
    const checkRequest = vi.fn(async (url: URL) => ({
      blocked: url.pathname === '/blocked',
    }))
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest,
    })
    try {
      const target = `http://127.0.0.1:${port}`
      expect(
        await requestFirewallFixture(proxy.url, `${target}/allowed`, {
          'proxy-authorization': 'fixture',
          connection: 'x-fixture',
          'x-fixture': 'remove',
        }),
      ).toEqual({ status: 200, body: 'artifact' })
      expect(
        (await requestFirewallFixture(proxy.url, `${target}/blocked`)).status,
      ).toBe(403)
      expect(received).toHaveLength(1)
      expect(received[0]).not.toHaveProperty('proxy-authorization')
      expect(received[0]).not.toHaveProperty('x-fixture')
      expect(checkRequest).toHaveBeenCalledTimes(2)
    } finally {
      await proxy.close()
      await closeFirewallFixture(upstream)
    }
  })

  it('fails closed when policy rejects or hangs', async () => {
    const failed = await startFirewallProxy({
      certificateAuthority,
      checkRequest: async () => {
        throw new Error('fixture policy unavailable')
      },
    })
    try {
      expect(
        (await requestFirewallFixture(failed.url, 'http://localhost/')).status,
      ).toBe(502)
    } finally {
      await failed.close()
    }
    const stalled = await startFirewallProxy({
      certificateAuthority,
      timeoutMs: 100,
      checkRequest: () => new Promise(() => {}),
    })
    try {
      expect(
        (await requestFirewallFixture(stalled.url, 'http://localhost/')).status,
      ).toBe(504)
    } finally {
      await stalled.close()
    }
  })

  it('inspects repeated requests on one TLS tunnel and binds the authority', async () => {
    const upstream = https.createServer(
      certificateAuthority.issue('localhost'),
      (request, response) => {
        response.end('artifact')
      },
    )
    const port = await listenFirewallFixture(upstream)
    const checkRequest = vi.fn(async (url: URL) => ({
      blocked: url.pathname === '/blocked',
    }))
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest,
      upstreamCa: [certificateAuthority.certificate],
    })
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    try {
      const socket = await connectFirewallFixture(
        proxy.url,
        `localhost:${port}`,
        certificateAuthority.certificate,
      )
      expect(
        await requestFirewallTunnel(
          socket,
          `localhost:${port}`,
          '/allowed',
          agent,
        ),
      ).toBe(200)
      expect(
        await requestFirewallTunnel(
          socket,
          `localhost:${port}`,
          '/blocked',
          agent,
        ),
      ).toBe(403)
      expect(checkRequest).toHaveBeenCalledTimes(2)
      agent.destroy()
      const mismatch = await connectFirewallFixture(
        proxy.url,
        `localhost:${port}`,
        certificateAuthority.certificate,
      )
      expect(
        await requestFirewallTunnel(
          mismatch,
          'other.example',
          '/allowed',
          agent,
        ),
      ).toBe(400)
      expect(checkRequest).toHaveBeenCalledTimes(2)
    } finally {
      agent.destroy()
      await proxy.close()
      await closeFirewallFixture(upstream)
    }
  })

  it('rejects untrusted upstream TLS and mismatched tunnel SNI', async () => {
    const upstream = https.createServer(
      certificateAuthority.issue('localhost'),
      (request, response) => response.end('artifact'),
    )
    const port = await listenFirewallFixture(upstream)
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest: async () => ({ blocked: false }),
    })
    const agent = new http.Agent()
    try {
      const socket = await connectFirewallFixture(
        proxy.url,
        `localhost:${port}`,
        certificateAuthority.certificate,
      )
      expect(
        await requestFirewallTunnel(socket, `localhost:${port}`, '/', agent),
      ).toBe(502)
      await expect(
        connectFirewallFixture(
          proxy.url,
          `localhost:${port}`,
          certificateAuthority.certificate,
          'other.example',
        ),
      ).rejects.toThrow()
    } finally {
      agent.destroy()
      await proxy.close()
      await closeFirewallFixture(upstream)
    }
  })

  it('preserves TLS for explicitly bypassed destinations', async () => {
    const upstream = https.createServer(
      certificateAuthority.issue('localhost'),
      (request, response) => response.end('artifact'),
    )
    const port = await listenFirewallFixture(upstream)
    const checkRequest = vi.fn(async () => ({ blocked: false }))
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest,
      resolveDestination: () => 'bypass',
    })
    const agent = new http.Agent()
    try {
      const socket = await connectFirewallFixture(
        proxy.url,
        `localhost:${port}`,
        certificateAuthority.certificate,
      )
      expect(
        await requestFirewallTunnel(socket, `localhost:${port}`, '/', agent),
      ).toBe(200)
      expect(checkRequest).not.toHaveBeenCalled()
    } finally {
      agent.destroy()
      await proxy.close()
      await closeFirewallFixture(upstream)
    }
  })
  it('routes inspected requests through an upstream proxy', async () => {
    const origin = http.createServer((request, response) =>
      response.end('upstream artifact'),
    )
    const originPort = await listenFirewallFixture(origin)
    let connects = 0
    const intermediary = http.createServer()
    const remotes = new Set<ReturnType<typeof connect>>()
    intermediary.on('connect', (request, socket, head) => {
      connects += 1
      const target = new URL(`http://${request.url}`)
      const remote = connect(
        { host: target.hostname, port: Number(target.port) },
        () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          if (head.length) {
            remote.write(head)
          }
          socket.pipe(remote).pipe(socket)
        },
      )
      remotes.add(remote)
      socket.on('error', () => remote.destroy())
      remote.on('error', () => socket.destroy())
      socket.once('close', () => remote.destroy())
      remote.once('close', () => {
        remotes.delete(remote)
        socket.destroy()
      })
    })
    const intermediaryPort = await listenFirewallFixture(intermediary)
    const proxy = await startFirewallProxy({
      certificateAuthority,
      upstreamProxy: `http://127.0.0.1:${intermediaryPort}`,
      checkRequest: async () => ({ blocked: false }),
    })
    try {
      expect(
        await requestFirewallFixture(
          proxy.url,
          `http://127.0.0.1:${originPort}/artifact`,
        ),
      ).toEqual({ status: 200, body: 'upstream artifact' })
      expect(connects).toBe(1)
    } finally {
      await proxy.close()
      for (const remote of remotes) {
        remote.destroy()
      }
      await closeFirewallFixture(intermediary)
      await closeFirewallFixture(origin)
    }
  })

  it('refuses blocked CONNECT destinations and closes idle tunnels', async () => {
    const blocked = await startFirewallProxy({
      certificateAuthority,
      resolveDestination: () => 'block',
      checkRequest: async () => ({ blocked: false }),
    })
    try {
      await expect(
        connectFirewallFixture(
          blocked.url,
          'localhost:443',
          certificateAuthority.certificate,
        ),
      ).rejects.toThrow()
    } finally {
      await blocked.close()
    }
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest: async () => ({ blocked: false }),
    })
    const socket = await connectFirewallFixture(
      proxy.url,
      'localhost:443',
      certificateAuthority.certificate,
    )
    const ended = new Promise<void>(resolve => socket.once('close', resolve))
    await proxy.close()
    await ended
    await proxy.close()
  })
})
