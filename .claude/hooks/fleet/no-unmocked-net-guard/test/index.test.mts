import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  hasNetworkCall,
  isTestFilePath,
  onlyLocalhostHosts,
  referencesNock,
  shouldBlock,
} from '../index.mts'

describe('isTestFilePath', () => {
  it('matches *.test.* and test/ dirs', () => {
    assert.equal(isTestFilePath('src/foo.test.mts'), true)
    assert.equal(isTestFilePath('test/registry-cran.test.mts'), true)
    assert.equal(isTestFilePath('pkg/__tests__/a.spec.ts'), true)
    assert.equal(isTestFilePath('src/foo.mts'), false)
    assert.equal(isTestFilePath('scripts/build.mts'), false)
  })
})

describe('hasNetworkCall', () => {
  it('flags fleet HTTP helpers and fetch', () => {
    assert.equal(hasNetworkCall('await httpJson(url)'), true)
    assert.equal(hasNetworkCall('const r = httpText( x )'), true)
    assert.equal(hasNetworkCall('await fetch(`https://x`)'), true)
    assert.equal(hasNetworkCall('client.request(opts)'), true)
    assert.equal(hasNetworkCall('const x = 1'), false)
  })
})

describe('referencesNock / onlyLocalhostHosts', () => {
  it('detects nock usage', () => {
    assert.equal(referencesNock("import nock from 'nock'"), true)
    assert.equal(referencesNock('no mocking here'), false)
  })
  it('treats localhost-only hosts as allowed', () => {
    assert.equal(onlyLocalhostHosts('fetch("http://127.0.0.1:8080/x")'), true)
    assert.equal(onlyLocalhostHosts('fetch("http://localhost/x")'), true)
    assert.equal(onlyLocalhostHosts('fetch("https://api.example.com")'), false)
    // No literal host present -> can't prove localhost-only.
    assert.equal(onlyLocalhostHosts('fetch(url)'), false)
  })
})

describe('shouldBlock', () => {
  const unmocked =
    "import { httpJson } from 'x'\nit('t', async () => { await httpJson('https://api.anaconda.org/p') })"
  const mocked =
    "import nock from 'nock'\nit('t', async () => { nock('https://api.anaconda.org').get('/p').reply(200,{}); await httpJson('https://api.anaconda.org/p') })"
  const localhostOnly =
    "it('t', async () => { await fetch('http://127.0.0.1:9/p') })"

  it('blocks an unmocked third-party call in a test file', () => {
    assert.equal(shouldBlock('test/x.test.mts', unmocked), true)
  })
  it('allows when nock is present', () => {
    assert.equal(shouldBlock('test/x.test.mts', mocked), false)
  })
  it('allows localhost-only calls', () => {
    assert.equal(shouldBlock('test/x.test.mts', localhostOnly), false)
  })
  it('ignores non-test files', () => {
    assert.equal(shouldBlock('src/x.mts', unmocked), false)
  })
  it('ignores test files with no network call', () => {
    assert.equal(shouldBlock('test/x.test.mts', 'const a = 1'), false)
  })
})
