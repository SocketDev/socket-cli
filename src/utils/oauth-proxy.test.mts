import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  OAUTH_ISSUER,
  OAUTH_RESOURCE,
  resolveOAuthAccessToken,
} from './oauth.mts'

let directory: string
afterEach(async () => {
  if (directory) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('OAuth proxy request deadline', () => {
  it('rejects a stalled CONNECT and releases the cross-process lock', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'socket-oauth-proxy-'))
    await writeFile(
      path.join(directory, 'oauth.json'),
      `${JSON.stringify({
        version: 1,
        issuer: OAUTH_ISSUER,
        resource: OAUTH_RESOURCE,
        apiOrigin: OAUTH_ISSUER,
        clientId: 'test-client',
        accessToken: 'expired-access',
        refreshToken: 'one-time-refresh',
        expiresAt: Date.now() - 1,
        scopes: ['packages:list', 'alerts:list', 'threat-feed:list'],
        tokenEndpoint: `${OAUTH_ISSUER}/v1/oauth2/token`,
      })}\n`,
      { mode: 0o600 },
    )
    const proxy = createServer()
    const sockets = new Set<import('node:net').Socket>()
    let connected!: () => void
    const didConnect = new Promise<void>(resolve => {
      connected = resolve
    })
    proxy.on('connect', (_request, socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      connected() // Intentionally leave CONNECT unanswered.
    })
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
    const address = proxy.address()
    if (!address || typeof address === 'string') {
      throw new Error('proxy failed to bind')
    }
    try {
      const pending = resolveOAuthAccessToken(directory, {
        apiProxy: `http://127.0.0.1:${address.port}/`,
        requestTimeoutMs: 1_000,
      })
      const connectObserved = await Promise.race([
        didConnect.then(() => true),
        new Promise<boolean>(resolve =>
          setTimeout(() => resolve(false), 1_000),
        ),
      ])
      expect(connectObserved).toBe(true)
      await expect(pending).rejects.toThrow('timed out')
      await expect(
        stat(path.join(directory, 'oauth.json.lock')),
      ).rejects.toMatchObject({ code: 'ENOENT' })
      const stored = JSON.parse(
        await readFile(path.join(directory, 'oauth.json'), 'utf8'),
      )
      expect(stored.refreshToken).toBeUndefined()
    } finally {
      proxy.closeAllConnections()
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise<void>(resolve => proxy.close(() => resolve()))
    }
  }, 5_000)
})
