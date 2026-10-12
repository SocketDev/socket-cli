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

  it('sanitizes signing failures before notarization or verification', async () => {
    const privateDetail = 'fixture signer credential detail'
    const sign = vi.fn(async () => {
      throw new Error(privateDetail)
    })
    const notarize = vi.fn(async () => true)
    const spawnProcess = successfulSpawn()
    const rejection = await signAndNotarizeSeaBinary('/tmp/socket', {
      sign,
      notarize,
      spawnProcess,
      platform: 'darwin',
    }).then(
      () => undefined,
      error => error,
    )

    expect(rejection).toBeInstanceOf(Error)
    expect(String(rejection)).not.toContain(privateDetail)
    expect(sign).toHaveBeenCalledTimes(1)
    expect(notarize).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
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

  it('verifies after notarization without exposing verifier output', async () => {
    const steps: string[] = []
    const sign = vi.fn(async () => {
      steps.push('sign')
      return true
    })
    const notarize = vi.fn(async () => {
      steps.push('notarize')
      return true
    })
    const privateStderr = 'fixture private verifier output'
    let verificationCount = 0
    const spawnProcess = vi.fn<SeaSignSpawn>(async (command, args) => {
      verificationCount += 1
      steps.push('verify')
      return {
        code: verificationCount === 1 ? 0 : 1,
        stdout: '',
        stderr: verificationCount === 1 ? '' : privateStderr,
        signal: null,
        cmd: command,
        args,
      }
    })
    const rejection = await signAndNotarizeSeaBinary('/tmp/socket', {
      sign,
      notarize,
      spawnProcess,
      platform: 'darwin',
    }).then(
      () => undefined,
      error => error,
    )

    expect(rejection).toBeInstanceOf(Error)
    expect(String(rejection)).not.toContain(privateStderr)
    expect(steps).toEqual(['sign', 'verify', 'notarize', 'verify'])
    expect(sign).toHaveBeenCalledTimes(1)
    expect(notarize).toHaveBeenCalledTimes(1)
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    expect(spawnProcess).toHaveBeenNthCalledWith(
      1,
      'codesign',
      ['--verify', '--strict', '/tmp/socket'],
      { stdio: 'pipe', timeout: 30_000 },
    )
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      'codesign',
      ['--verify', '--strict', '/tmp/socket'],
      { stdio: 'pipe', timeout: 30_000 },
    )
  })

  it.each(['', '  ', '\n'])(
    'rejects an empty or whitespace binary path before dependency calls',
    async binaryPath => {
      const sign = vi.fn()
      const notarize = vi.fn()
      const spawnProcess = vi.fn<SeaSignSpawn>()
      await expect(
        signAndNotarizeSeaBinary(binaryPath, {
          sign,
          notarize,
          spawnProcess,
          platform: 'darwin',
        }),
      ).rejects.toThrow()
      expect(sign).not.toHaveBeenCalled()
      expect(notarize).not.toHaveBeenCalled()
      expect(spawnProcess).not.toHaveBeenCalled()
    },
  )

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
