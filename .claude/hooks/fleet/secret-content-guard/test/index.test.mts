// node --test specs for secret-content-guard's shared detection core
// (scanSecretValues in _shared/token-patterns.mts). The guard wraps this with
// withEditGuard + the bypass check; the detection is the testable logic.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  SECRET_VALUE_PATTERNS,
  scanSecretValues,
} from '../../_shared/token-patterns.mts'

test('flags an AWS access key id', () => {
  const hit = scanSecretValues('const k = "AKIAIOSFODNN7EXAMPLE"')
  assert.equal(hit?.label, 'AWS access key ID (AKIA)')
})

test('flags a GitHub PAT', () => {
  const hit = scanSecretValues('token: ghp_abcdefghijklmnopqrstuvwxyz0123456789')
  assert.equal(hit?.label, 'GitHub personal access token (ghp_)')
})

test('flags a Socket API key (sktsec_)', () => {
  const hit = scanSecretValues('SOCKET_API_KEY=sktsec_abc123abc123abc123abc123')
  assert.equal(hit?.label, 'Socket API key (sktsec_)')
})

test('flags a PEM private-key header', () => {
  const hit = scanSecretValues('-----BEGIN RSA PRIVATE KEY-----\nMIIE...')
  assert.equal(hit?.label, 'private key (PEM block)')
})

test('flags a JWT', () => {
  const hit = scanSecretValues(
    'auth = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N"',
  )
  assert.equal(hit?.label, 'JWT')
})

test('returns the matched substring (so the guard can withhold it)', () => {
  const hit = scanSecretValues('AKIAIOSFODNN7EXAMPLE')
  assert.equal(hit?.match, 'AKIAIOSFODNN7EXAMPLE')
})

test('passes clean content', () => {
  assert.equal(scanSecretValues('const greeting = "hello world"'), undefined)
  assert.equal(scanSecretValues('export const PORT = 3000'), undefined)
})

test('does not flag a redacted placeholder', () => {
  assert.equal(scanSecretValues('SOCKET_API_KEY=sktsec_<your-token-here>'), undefined)
  assert.equal(scanSecretValues('AWS key: AKIA…redacted'), undefined)
})

test('every pattern has a non-empty label and a RegExp', () => {
  for (const p of SECRET_VALUE_PATTERNS) {
    assert.ok(p.re instanceof RegExp)
    assert.equal(typeof p.label, 'string')
    assert.ok(p.label.length > 0)
  }
})

test('catalog is a superset of the commit-side scanners (AWS, GitHub, private key, Socket)', () => {
  const labels = SECRET_VALUE_PATTERNS.map(p => p.label).join(' | ')
  assert.match(labels, /AWS/)
  assert.match(labels, /GitHub/)
  assert.match(labels, /private key/)
  assert.match(labels, /Socket/)
})
