/**
 * @file Unit tests for findKeychainReads — the structural matcher that
 *   classifies a Bash command string into keychain READ hits (vs writes,
 *   deletes, and unrelated commands).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { findKeychainReads } from '../index.mts'

test('macOS find-generic-password is flagged', () => {
  const hits = findKeychainReads(
    'security find-generic-password -s socket-cli -a SOCKET_API_KEY -w',
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.platform, 'macos')
})

test('macOS find-internet-password is flagged', () => {
  const hits = findKeychainReads(
    'security find-internet-password -s example.com -a user',
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.platform, 'macos')
})

test('macOS add-generic-password is NOT flagged (write)', () => {
  const hits = findKeychainReads(
    'security add-generic-password -U -s socket-cli -a SOCKET_API_KEY -w xxx',
  )
  assert.equal(hits.length, 0)
})

test('macOS delete-generic-password is NOT flagged (delete)', () => {
  const hits = findKeychainReads(
    'security delete-generic-password -s socket-cli -a SOCKET_API_KEY',
  )
  assert.equal(hits.length, 0)
})

test('Linux secret-tool lookup is flagged', () => {
  const hits = findKeychainReads(
    'secret-tool lookup service socket-cli user SOCKET_API_KEY',
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.platform, 'linux')
})

test('Linux secret-tool search is flagged', () => {
  const hits = findKeychainReads('secret-tool search service socket-cli')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.platform, 'linux')
})

test('Linux secret-tool store is NOT flagged (write)', () => {
  const hits = findKeychainReads(
    'secret-tool store --label="Socket API token" service socket-cli user SOCKET_API_KEY',
  )
  assert.equal(hits.length, 0)
})

test('Linux secret-tool clear is NOT flagged (delete)', () => {
  const hits = findKeychainReads(
    'secret-tool clear service socket-cli user SOCKET_API_KEY',
  )
  assert.equal(hits.length, 0)
})

test('Windows Get-StoredCredential is flagged', () => {
  const hits = findKeychainReads(
    'powershell -Command "(Get-StoredCredential -Target \'socket-cli:SOCKET_API_KEY\').Password"',
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.platform, 'windows')
})

test('Windows Get-Credential | ConvertFrom-SecureString is flagged', () => {
  const hits = findKeychainReads(
    'Get-Credential -Credential admin | ConvertFrom-SecureString -AsPlainText',
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.platform, 'windows')
})

test('Windows Get-Credential WITHOUT pipe is NOT flagged (fresh prompt)', () => {
  // Bare Get-Credential is an interactive fresh-prompt flow, not a
  // readback of a stored credential. Don't block.
  const hits = findKeychainReads('$cred = Get-Credential -Credential admin')
  assert.equal(hits.length, 0)
})

test('Windows New-StoredCredential is NOT flagged (write)', () => {
  const hits = findKeychainReads(
    "New-StoredCredential -Target 'socket-cli:SOCKET_API_KEY' -UserName x -SecurePassword $s",
  )
  assert.equal(hits.length, 0)
})

test('keyring get is flagged', () => {
  const hits = findKeychainReads('keyring get socket-cli SOCKET_API_KEY')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.platform, 'cross-platform')
})

test('keyring set is NOT flagged (write)', () => {
  const hits = findKeychainReads('keyring set socket-cli SOCKET_API_KEY')
  assert.equal(hits.length, 0)
})

test('chained reads count separately', () => {
  // && chain with two reads
  const hits = findKeychainReads(
    'security find-generic-password -s a -a b -w && secret-tool lookup service a user b',
  )
  assert.equal(hits.length, 2)
})

test('unrelated commands are not flagged', () => {
  for (const cmd of [
    'ls -la',
    'git log --oneline -5',
    'echo $SOCKET_API_KEY',
    'pnpm install',
    'grep security file.txt',
    'security delete-keychain ~/Library/Keychains/foo.keychain',
  ]) {
    const hits = findKeychainReads(cmd)
    assert.equal(hits.length, 0, `should not flag: ${cmd}`)
  }
})

test('command substitution wrapping is still flagged', () => {
  // The structural matcher is intentionally a regex, not an AST. This
  // catches the common subshell shape — verifying the inner verb is
  // detected even inside `$(...)`. AST-based parsing is overkill for
  // a non-security-critical reminder hook.
  const hits = findKeychainReads(
    'TOKEN="$(security find-generic-password -s socket-cli -a SOCKET_API_KEY -w)" && echo done',
  )
  assert.equal(hits.length, 1)
})
