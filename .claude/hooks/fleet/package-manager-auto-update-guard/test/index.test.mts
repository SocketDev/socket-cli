// node --test specs for package-manager-auto-update-guard's shared core.
// Covers the pure, machine-state-independent logic: invocation matching,
// bypass-phrase generation, env parsing, platform applicability.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AUTO_UPDATE_CHECKS,
  BLANKET_BYPASS_PHRASE,
  bypassPhrasesFor,
  envIsOn,
  matchInvokedManager,
  platformApplies,
} from '../../_shared/package-manager-auto-update.mts'

test('matchInvokedManager: matches a bare brew install', () => {
  const check = matchInvokedManager('brew install ripgrep')
  assert.equal(check?.id, 'homebrew')
})

test('matchInvokedManager: matches brew reached via && chain', () => {
  const check = matchInvokedManager('echo hi && brew upgrade')
  assert.equal(check?.id, 'homebrew')
})

test('matchInvokedManager: matches choco / winget / scoop / npm / pnpm', () => {
  assert.equal(matchInvokedManager('choco install foo')?.id, 'chocolatey')
  assert.equal(matchInvokedManager('winget install foo')?.id, 'winget')
  assert.equal(matchInvokedManager('scoop install foo')?.id, 'scoop')
  assert.equal(matchInvokedManager('npm install foo')?.id, 'npm')
  assert.equal(matchInvokedManager('pnpm add foo')?.id, 'pnpm')
})

test('matchInvokedManager: returns undefined for an unrelated command', () => {
  assert.equal(matchInvokedManager('git status'), undefined)
  assert.equal(matchInvokedManager('ls -la'), undefined)
})

test('matchInvokedManager: does not match a substring (brewery)', () => {
  assert.equal(matchInvokedManager('brewery --help'), undefined)
})

test('bypassPhrasesFor: includes the blanket phrase plus id + binary forms', () => {
  const brew = AUTO_UPDATE_CHECKS.find(c => c.id === 'homebrew')!
  const phrases = bypassPhrasesFor(brew)
  assert.ok(phrases.includes(BLANKET_BYPASS_PHRASE))
  assert.ok(phrases.includes('Allow homebrew auto-update bypass'))
  assert.ok(phrases.includes('Allow brew auto-update bypass'))
})

test('bypassPhrasesFor: dedupes when id equals binary (npm)', () => {
  const npm = AUTO_UPDATE_CHECKS.find(c => c.id === 'npm')!
  const phrases = bypassPhrasesFor(npm)
  const npmPhrase = 'Allow npm auto-update bypass'
  assert.equal(phrases.filter(p => p === npmPhrase).length, 1)
})

test('envIsOn: truthy values', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
    process.env['__T_AU'] = v
    assert.equal(envIsOn('__T_AU'), true, `expected ${v} truthy`)
  }
  delete process.env['__T_AU']
})

test('envIsOn: falsy / unset values', () => {
  for (const v of ['0', 'false', '', 'no']) {
    process.env['__T_AU'] = v
    assert.equal(envIsOn('__T_AU'), false, `expected ${v} falsy`)
  }
  delete process.env['__T_AU']
  assert.equal(envIsOn('__T_AU'), false)
})

test('platformApplies: "all" always applies; specific matches current OS', () => {
  assert.equal(platformApplies('all'), true)
  assert.equal(platformApplies(process.platform as 'darwin'), true)
  const other = process.platform === 'darwin' ? 'win32' : 'darwin'
  assert.equal(platformApplies(other as 'win32'), false)
})

test('every check declares id, binaries, platform, fix, detect', () => {
  for (const c of AUTO_UPDATE_CHECKS) {
    assert.equal(typeof c.id, 'string')
    assert.ok(c.binaries.length > 0)
    assert.ok(['darwin', 'linux', 'win32', 'all'].includes(c.platform))
    assert.equal(typeof c.fix, 'string')
    assert.equal(typeof c.detect, 'function')
  }
})
