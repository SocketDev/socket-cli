import http from 'node:http'
import { connect } from 'node:tls'
import type { AddressInfo } from 'node:net'
import type { TLSSocket } from 'node:tls'

export async function listenFirewallFixture(
  server: http.Server,
): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

export async function closeFirewallFixture(server: http.Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

export async function requestFirewallFixture(
  proxy: string,
  target: string,
  extraHeaders = {},
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const request = http.get(
      proxy,
      {
        path: target,
        headers: { host: new URL(target).host, ...extraHeaders },
      },
      response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => {
          body += chunk
        })
        response.on('end', () =>
          resolve({ status: response.statusCode!, body }),
        )
      },
    )
    request.setTimeout(2000, () =>
      request.destroy(new Error('Firewall fixture request timed out')),
    )
    request.on('error', reject)
  })
}

export async function connectFirewallFixture(
  proxy: string,
  authority: string,
  ca: string,
  servername = 'localhost',
): Promise<TLSSocket> {
  return await new Promise((resolve, reject) => {
    const request = http.request(proxy, {
      method: 'CONNECT',
      path: authority,
      headers: { host: authority },
    })
    request.once('error', reject)
    request.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(new Error('CONNECT rejected'))
        return
      }
      if (head.length) {
        socket.unshift(head)
      }
      const secure = connect({ socket, ca, servername }, () => resolve(secure))
      secure.once('error', reject)
    })
    request.end()
  })
}

export async function requestFirewallTunnel(
  socket: TLSSocket,
  host: string,
  path: string,
  agent: http.Agent,
): Promise<number> {
  agent.createConnection = () => socket
  return await new Promise((resolve, reject) => {
    const request = http.get(
      { host: 'localhost', path, headers: { host }, agent },
      response => {
        response.resume()
        response.once('end', () => resolve(response.statusCode!))
      },
    )
    request.setTimeout(2000, () =>
      request.destroy(new Error('Firewall fixture request timed out')),
    )
    request.on('error', reject)
  })
}
