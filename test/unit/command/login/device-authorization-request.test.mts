import { describe, expect, it } from 'vitest'

import { createDeviceAuthorizationRequest } from '../../../../src/command/login/device-authorization-request.mts'

describe('createDeviceAuthorizationRequest', () => {
  it('uses the device grant endpoint under the configured OAuth base', () => {
    const request = createDeviceAuthorizationRequest(
      new URL('https://api.socket.dev/v1/oauth2/'),
      'socket-cli',
    )

    expect(request.url.href).toBe(
      'https://api.socket.dev/v1/oauth2/device/authorize',
    )
    expect(request.body.get('client_id')).toBe('socket-cli')
  })

  it('preserves custom OAuth hosts, path prefixes, and client IDs', () => {
    const base = new URL('https://auth.example.com/socket/v1/oauth2/')
    const request = createDeviceAuthorizationRequest(base, 'custom-cli')

    expect(request.url.href).toBe(
      'https://auth.example.com/socket/v1/oauth2/device/authorize',
    )
    expect(request.body.get('client_id')).toBe('custom-cli')
    expect(base.href).toBe('https://auth.example.com/socket/v1/oauth2/')
  })

  it('requests scan creation and reporting without administrative scopes', () => {
    const request = createDeviceAuthorizationRequest(
      new URL('https://api.socket.dev/v1/oauth2/'),
      'socket-cli',
    )

    expect(request.body.get('scope')?.split(' ')).toEqual([
      'alerts:list',
      'dependencies:list',
      'diff-scans:list',
      'full-scans:create',
      'full-scans:list',
      'packages:list',
      'repo:list',
      'security-policy:read',
    ])
    expect([...request.body.keys()]).toEqual(['client_id', 'scope'])
  })
})
