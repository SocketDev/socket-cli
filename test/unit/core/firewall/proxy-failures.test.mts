import http from 'node:http'
import https from 'node:https'
import { connect } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  ensureFirewallCertificateAuthority,
  loadFirewallCertificateAuthority,
} from '../../../../src/core/firewall/certificates.mts'
import type { FirewallCertificateAuthority } from '../../../../src/core/firewall/certificates.mts'
import { startFirewallProxy } from '../../../../src/core/firewall/proxy.mts'
import {
  closeFirewallFixture,
  connectFirewallFixture,
  listenFirewallFixture,
  requestFirewallFixture,
  requestFirewallTunnel,
} from './proxy-fixture.mts'

let directory: string
let certificateAuthority: FirewallCertificateAuthority
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'firewall-proxy-failures-'))
  certificateAuthority = await loadFirewallCertificateAuthority(
    await ensureFirewallCertificateAuthority({ directory }),
  )
})
afterAll(async () => {
  await safeDelete(directory)
})

describe('firewall proxy failure boundaries', () => {
  it('rejects malformed targets, unsupported methods, and invalid CONNECT authorities', async () => {
    const checkRequest = vi.fn(async () => ({ blocked: false }))
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest,
    })
    try {
      expect(
        (
          await requestFirewallFixture(proxy.url, 'http://localhost/artifact', {
            host: 'other.example',
          })
        ).status,
      ).toBe(400)
      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request(
          proxy.url,
          {
            method: 'TRACE',
            path: 'http://localhost/',
            headers: { host: 'localhost' },
          },
          response => {
            response.resume()
            resolve(response.statusCode!)
          },
        )
        request.on('error', reject)
        request.end()
      })
      expect(status).toBe(405)
      await expect(
        connectFirewallFixture(
          proxy.url,
          'localhost/path:443',
          certificateAuthority.certificate,
        ),
      ).rejects.toThrow()
      await expect(
        connectFirewallFixture(
          proxy.url,
          'invalid:999999',
          certificateAuthority.certificate,
        ),
      ).rejects.toThrow()
      expect(checkRequest).not.toHaveBeenCalled()
    } finally {
      await proxy.close()
    }
    await expect(
      startFirewallProxy({
        certificateAuthority,
        checkRequest,
        upstreamProxy: 'socks://localhost:1080',
      }),
    ).rejects.toThrow()
  })

  it('bounds a stalled origin and closes requests still in flight', async () => {
    const reached = Promise.withResolvers<void>()
    const upstream = http.createServer(() => reached.resolve())
    const port = await listenFirewallFixture(upstream)
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest: async () => ({ blocked: false }),
      timeoutMs: 100,
    })
    try {
      const response = requestFirewallFixture(
        proxy.url,
        `http://127.0.0.1:${port}/artifact`,
      )
      await reached.promise
      expect((await response).status).toBe(504)
      const pending = requestFirewallFixture(
        proxy.url,
        `http://127.0.0.1:${port}/artifact`,
      )
      const rejection = expect(pending).rejects.toThrow()
      await proxy.close()
      await rejection
    } finally {
      await proxy.close()
      await closeFirewallFixture(upstream)
    }
  })

  it('preserves bypass TLS through an authenticated TLS upstream proxy', async () => {
    const origin = https.createServer(
      certificateAuthority.issue('localhost'),
      (request, response) => response.end('artifact'),
    )
    const originPort = await listenFirewallFixture(origin)
    let authorization: string | undefined
    const intermediary = https.createServer(
      certificateAuthority.issue('localhost'),
    )
    const remotes = new Set<ReturnType<typeof connect>>()
    intermediary.on('connect', (request, socket, head) => {
      authorization = request.headers['proxy-authorization']
      const remote = connect({ host: '127.0.0.1', port: originPort }, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) {
          remote.write(head)
        }
        socket.pipe(remote).pipe(socket)
      })
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
      checkRequest: async () => ({ blocked: false }),
      resolveDestination: () => 'bypass',
      upstreamProxy: `https://example-user:EXAMPLE_PASSWORD_DO_NOT_USE@localhost:${intermediaryPort}`,
      upstreamCa: [certificateAuthority.certificate],
    })
    const agent = new http.Agent()
    try {
      const socket = await connectFirewallFixture(
        proxy.url,
        `localhost:${originPort}`,
        certificateAuthority.certificate,
      )
      expect(
        await requestFirewallTunnel(
          socket,
          `localhost:${originPort}`,
          '/',
          agent,
        ),
      ).toBe(200)
      expect(authorization).toBe(
        `Basic ${Buffer.from('example-user:EXAMPLE_PASSWORD_DO_NOT_USE').toString('base64')}`,
      )
    } finally {
      agent.destroy()
      await proxy.close()
      for (const remote of remotes) {
        remote.destroy()
      }
      await closeFirewallFixture(intermediary)
      await closeFirewallFixture(origin)
    }
  })

  it('fails bypass tunnels closed when the upstream proxy refuses CONNECT', async () => {
    const intermediary = http.createServer()
    intermediary.on('connect', (request, socket) =>
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'),
    )
    const port = await listenFirewallFixture(intermediary)
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest: async () => ({ blocked: false }),
      resolveDestination: () => 'bypass',
      upstreamProxy: `http://127.0.0.1:${port}`,
    })
    try {
      await expect(
        connectFirewallFixture(
          proxy.url,
          'localhost:443',
          certificateAuthority.certificate,
        ),
      ).rejects.toThrow()
    } finally {
      await proxy.close()
      await closeFirewallFixture(intermediary)
    }
  })

  it('closes malformed HTTP, upgrades, and idle clients', async () => {
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest: async () => ({ blocked: false }),
      timeoutMs: 100,
    })
    try {
      for (const payload of [
        'invalid\r\n\r\n',
        'GET http://localhost/ HTTP/1.1\r\nHost: localhost\r\nConnection: upgrade\r\nUpgrade: websocket\r\n\r\n',
        '',
      ]) {
        const address = new URL(proxy.url)
        const socket = connect(
          { host: address.hostname, port: Number(address.port) },
          () => {
            if (payload) {
              socket.write(payload)
            }
          },
        )
        await new Promise<void>(resolve => {
          socket.on('error', () => {})
          socket.once('close', () => resolve())
        })
        expect(socket.destroyed).toBe(true)
      }
    } finally {
      await proxy.close()
    }
  })
})
