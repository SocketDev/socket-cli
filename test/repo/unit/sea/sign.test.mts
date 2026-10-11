import { describe, expect, it, vi } from 'vitest'
import type { NotarizeCredentials } from '../../../../scripts/fleet/apple-notarize.mts'
import type { SeaSignSpawn } from '../../../../scripts/repo/build/sea/sign.mts'
import { signAndNotarizeSeaBinary } from '../../../../scripts/repo/build/sea/sign.mts'

function successfulSpawn(): SeaSignSpawn {
  return vi.fn(async (command, args) => ({
    code: 0,
    stdout: '',
    stderr: '',
    signal: null,
    cmd: command,
    args,
  }))
}

describe('signAndNotarizeSeaBinary', () => {
  it('signs with entitlements and verifies before and after notarization', async () => {
    const steps: string[] = []
    const credentials: NotarizeCredentials = {
      issuerId: 'issuer-id',
      keyId: 'key-id',
      keyPath: '/tmp/notary-key.p8',
    }
    const spawnProcess = vi.fn<SeaSignSpawn>(async (command, args) => {
      steps.push(`verify:${command}`)
      expect(args).toEqual(['--verify', '--strict', '/tmp/socket-darwin-arm64'])
      return {
        code: 0,
        stdout: '',
        stderr: '',
        signal: null,
        cmd: command,
        args,
      }
    })
    const sign = vi.fn(async (binaryPath, options) => {
      steps.push('sign')
      expect(binaryPath).toBe('/tmp/socket-darwin-arm64')
      expect(options).toEqual({
        entitlementsPath: '/tmp/sea.entitlements.plist',
        hardenedRuntime: true,
      })
      return true
    })
    const notarize = vi.fn(async (binaryPath, suppliedCredentials) => {
      steps.push('notarize')
      expect(binaryPath).toBe('/tmp/socket-darwin-arm64')
      expect(suppliedCredentials).toBe(credentials)
      return true
    })

    await signAndNotarizeSeaBinary('/tmp/socket-darwin-arm64', {
      credentials,
      entitlementsPath: '/tmp/sea.entitlements.plist',
      spawnProcess,
      sign,
      notarize,
      platform: 'darwin',
    })

    expect(steps).toEqual([
      'sign',
      'verify:codesign',
      'notarize',
      'verify:codesign',
    ])
  })

  it('rejects non-macOS hosts without invoking helpers', async () => {
    const sign = vi.fn()
    const notarize = vi.fn()
    const spawnProcess = vi.fn<SeaSignSpawn>()
    await expect(
      signAndNotarizeSeaBinary('/tmp/socket', {
        sign,
        notarize,
        spawnProcess,
        platform: 'linux',
      }),
    ).rejects.toThrow('require macOS')
    expect(sign).not.toHaveBeenCalled()
    expect(notarize).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('fails closed when signing returns false', async () => {
    const sign = vi.fn(async () => false)
    const notarize = vi.fn()
    await expect(
      signAndNotarizeSeaBinary('/tmp/socket', {
        sign,
        notarize,
        platform: 'darwin',
      }),
    ).rejects.toThrow('signing was unavailable')
    expect(notarize).not.toHaveBeenCalled()
  })

  it('fails closed when notarization returns false', async () => {
    const sign = vi.fn(async () => true)
    const notarize = vi.fn(async () => false)
    await expect(
      signAndNotarizeSeaBinary('/tmp/socket', {
        sign,
        notarize,
        spawnProcess: successfulSpawn(),
        platform: 'darwin',
      }),
    ).rejects.toThrow('notarization was unavailable')
  })

  it('rejects invalid signatures before notarization', async () => {
    const sign = vi.fn(async () => true)
    const notarize = vi.fn(async () => true)
    const spawnProcess = vi.fn<SeaSignSpawn>(async (command, args) => ({
      code: 1,
      stdout: '',
      stderr: 'private process output',
      signal: null,
      cmd: command,
      args,
    }))
    await expect(
      signAndNotarizeSeaBinary('/tmp/socket', {
        sign,
        notarize,
        spawnProcess,
        platform: 'darwin',
      }),
    ).rejects.toThrow('Strict code signature verification failed')
    expect(notarize).not.toHaveBeenCalled()
  })

  it('sanitizes notarization failures and does not verify afterward', async () => {
    const sign = vi.fn(async () => true)
    const notarize = vi.fn(async () => {
      throw new Error('private credential details')
    })
    const spawnProcess = successfulSpawn()
    await expect(
      signAndNotarizeSeaBinary('/tmp/socket', {
        sign,
        notarize,
        spawnProcess,
        platform: 'darwin',
      }),
    ).rejects.toThrow('Apple notarization failed for the SEA binary.')
    expect(spawnProcess).toHaveBeenCalledTimes(1)
  })
})
