import { describe, expect, it } from 'vitest'

import {
  collectFirewallErrorDiagnostics,
  formatFirewallError,
} from '../../../../src/util/firewall/proxy-errors.mts'

describe('firewall error diagnostics', () => {
  it('preserves nested aggregate and cause codes and network destinations', () => {
    const ipv4 = Object.assign(new Error(''), {
      code: 'ECONNREFUSED',
      address: '127.0.0.1',
      port: 8443,
    })
    const ipv6 = Object.assign(new Error(''), {
      code: 'ETIMEDOUT',
      address: '::1',
      port: 8443,
    })
    const error = new Error('outer', {
      cause: new AggregateError([ipv4, new AggregateError([ipv6])]),
    })
    expect(collectFirewallErrorDiagnostics(error)).toEqual([
      { name: 'Error' },
      { name: 'AggregateError' },
      { name: 'Error', code: 'ECONNREFUSED', address: '127.0.0.1', port: 8443 },
      { name: 'AggregateError' },
      { name: 'Error', code: 'ETIMEDOUT', address: '::1', port: 8443 },
    ])
    expect(formatFirewallError(error)).toContain(
      `${ipv4.code} ${ipv4.address}:${ipv4.port}`,
    )
    expect(formatFirewallError(error)).toContain(
      `${ipv6.code} [${ipv6.address}]:${ipv6.port}`,
    )
  })
  it('bounds cyclic errors and avoids emitting arbitrary error content', () => {
    const error = Object.assign(
      new Error(
        'https://example-user:EXAMPLE_PASSWORD_DO_NOT_USE@example.invalid/?token=EXAMPLE_TOKEN_DO_NOT_USE',
      ),
      { code: 'invalid\ncode', address: 'private.example', port: -1 },
    )
    Object.defineProperty(error, 'cause', { value: error })
    expect(collectFirewallErrorDiagnostics(error)).toEqual([{ name: 'Error' }])
    expect(formatFirewallError(error)).toBe('Error')
    expect(collectFirewallErrorDiagnostics('non-error fixture')).toEqual([
      { name: 'UnknownError' },
    ])
    expect(
      collectFirewallErrorDiagnostics(
        new AggregateError(Array.from({ length: 100 }, () => new Error(''))),
      ),
    ).toHaveLength(64)
  })
})
