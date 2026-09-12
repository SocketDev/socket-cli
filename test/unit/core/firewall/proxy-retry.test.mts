import http from 'node:http'
import { describe, expect, it, vi } from 'vitest'

import { spawnFirewallChild } from '../../../../src/core/firewall/child.mts'
import { startFirewallProxy } from '../../../../src/core/firewall/proxy.mts'
import {
  closeFirewallFixture,
  connectFirewallFixture,
  listenFirewallFixture,
  requestFirewallFixture,
} from './proxy-fixture.mts'

const certificateAuthority = {
  certificate: '',
  issue: () => {
    throw new Error('Unexpected certificate issuance for bypass')
  },
}

describe('firewall upstream connection retries', () => {
  it('fails only the request and lets the same wrapped child retry successfully', async () => {
    const origin = http.createServer()
    const port = await listenFirewallFixture(origin)
    await closeFirewallFixture(origin)
    const onRequestError = vi.fn(() => {
      if (!origin.listening) {
        origin.listen(port, '127.0.0.1')
      }
    })
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest: async () => ({ blocked: false }),
      resolveDestination: () => 'bypass',
      onRequestError,
    })
    const source = `const http = require('node:http');
function attempt() { return new Promise((resolve,reject) => {
 const request=http.request(process.argv[1], {method:'CONNECT',path:process.argv[2]});
 request.on('connect',(response,socket)=>{socket.destroy();resolve(response.statusCode)});
 request.on('error',reject);request.end();
}); }
(async()=>{try{await attempt();process.exitCode=91;return}catch{}
await new Promise(resolve=>setTimeout(resolve,100));
process.exitCode=(await attempt())===200?23:92;
})().catch(()=>{process.exitCode=93});`
    try {
      const result = await spawnFirewallChild({
        executable: process.execPath,
        args: ['-e', source, proxy.url, `127.0.0.1:${port}`],
        env: {},
        stdio: 'ignore',
      })
      expect(result.code).toBe(23)
      expect(onRequestError).toHaveBeenCalledTimes(1)
      expect(onRequestError.mock.calls[0]?.[0]).toContain(`127.0.0.1:${port}`)
    } finally {
      await proxy.close()
      await closeFirewallFixture(origin)
    }
  })

  it('settles refused proxy connections even when diagnostic callbacks throw', async () => {
    const origin = http.createServer()
    const port = await listenFirewallFixture(origin)
    await closeFirewallFixture(origin)
    const onRequestError = vi.fn(() => {
      throw new Error('fixture diagnostic failure')
    })
    const proxy = await startFirewallProxy({
      certificateAuthority,
      checkRequest: async () => ({ blocked: false }),
      resolveDestination: () => 'bypass',
      upstreamProxy: `http://127.0.0.1:${port}`,
      onRequestError,
      timeoutMs: 1000,
    })
    try {
      await expect(
        connectFirewallFixture(proxy.url, 'localhost:443', ''),
      ).rejects.toThrow()
      expect(onRequestError).toHaveBeenCalledTimes(1)
      const inspected = await requestFirewallFixture(
        proxy.url,
        'http://localhost/artifact',
      )
      expect(inspected.status).toBe(502)
      expect(onRequestError).toHaveBeenCalledTimes(2)
    } finally {
      await proxy.close()
    }
  })
})
