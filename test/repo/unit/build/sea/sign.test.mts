import { describe, expect, it, vi } from 'vitest'

import type { NotarizeCredentials } from '../../../../../scripts/fleet/apple-notarize.mts'
import type { AppleSignatureReceipt } from '../../../../../scripts/fleet/registry/apple/signature.mts'
import type { SeaSignOptions } from '../../../../../scripts/repo/build/sea/sign.mts'
import { signAndNotarizeSeaBinary } from '../../../../../scripts/repo/build/sea/sign.mts'

const teamId = 'A1B2C3D4E5'
const firstSignature: AppleSignatureReceipt = {
  teamId,
  verified: true,
  hardenedRuntime: true,
}
const finalSignature: AppleSignatureReceipt = {
  teamId,
  verified: true,
  hardenedRuntime: true,
}
const notaryReceipt = {
  submissionId: 'a1b2c3d4-e5f6-4789-8abc-0123456789ab',
  status: 'Accepted' as const,
}

function successfulOptions(overrides: Partial<SeaSignOptions> = {}): SeaSignOptions {
  return {
    appleTeamId: teamId,
    platform: 'darwin',
    sign: vi.fn(async () => true),
    verifySignature: vi.fn()
      .mockResolvedValueOnce(firstSignature)
      .mockResolvedValueOnce(finalSignature),
    notarize: vi.fn(async () => notaryReceipt),
    ...overrides,
  }
}

describe('signAndNotarizeSeaBinary', () => {
  it('signs, verifies on both sides of notarization, and returns final evidence', async () => {
    const steps: string[] = []
    const credentials: NotarizeCredentials = {
      issuerId: 'issuer-id',
      keyId: 'key-id',
      keyPath: '/tmp/notary-key.p8',
    }
    const sign = vi.fn(async (binaryPath, options) => {
      steps.push('sign')
      expect(binaryPath).toBe('/tmp/socket-darwin-arm64')
      expect(options).toEqual({
        entitlementsPath: '/tmp/sea.entitlements.plist',
        hardenedRuntime: true,
      })
      return true
    })
    const verifySignature = vi.fn()
      .mockImplementationOnce(async () => {
        steps.push('verify-before')
        return firstSignature
      })
      .mockImplementationOnce(async () => {
        steps.push('verify-after')
        return finalSignature
      })
    const notarize = vi.fn(async (binaryPath, suppliedCredentials) => {
      steps.push('notarize')
      expect(binaryPath).toBe('/tmp/socket-darwin-arm64')
      expect(suppliedCredentials).toBe(credentials)
      return notaryReceipt
    })

    await expect(signAndNotarizeSeaBinary('/tmp/socket-darwin-arm64', {
      ...successfulOptions(),
      credentials,
      entitlementsPath: '/tmp/sea.entitlements.plist',
      sign,
      notarize,
      verifySignature,
    })).resolves.toEqual({
      ...finalSignature,
      submissionId: notaryReceipt.submissionId,
      notarizationStatus: 'Accepted',
    })
    expect(steps).toEqual(['sign', 'verify-before', 'notarize', 'verify-after'])
    expect(verifySignature).toHaveBeenNthCalledWith(1, '/tmp/socket-darwin-arm64', teamId, { platform: 'darwin' })
    expect(verifySignature).toHaveBeenNthCalledWith(2, '/tmp/socket-darwin-arm64', teamId, { platform: 'darwin' })
  })

  it('rejects non-macOS hosts without invoking helpers', async () => {
    const options = successfulOptions({ platform: 'linux' })
    await expect(signAndNotarizeSeaBinary('/tmp/socket', options)).rejects.toThrow('require macOS')
    expect(options.sign).not.toHaveBeenCalled()
    expect(options.notarize).not.toHaveBeenCalled()
    expect(options.verifySignature).not.toHaveBeenCalled()
  })

  it.each(['', '  ', '\n'])(
    'rejects an empty or whitespace binary path before dependency calls',
    async binaryPath => {
      const options = successfulOptions()
      await expect(signAndNotarizeSeaBinary(binaryPath, options)).rejects.toThrow()
      expect(options.sign).not.toHaveBeenCalled()
      expect(options.notarize).not.toHaveBeenCalled()
      expect(options.verifySignature).not.toHaveBeenCalled()
    },
  )

  it.each(['', 'invalid', 'a1b2c3d4e5'])(
    'rejects missing or invalid Apple team identifiers before helper calls',
    async appleTeamId => {
      const options = successfulOptions({ appleTeamId })
      await expect(signAndNotarizeSeaBinary('/tmp/socket', options)).rejects.toThrow('team identifier')
      expect(options.sign).not.toHaveBeenCalled()
      expect(options.notarize).not.toHaveBeenCalled()
      expect(options.verifySignature).not.toHaveBeenCalled()
    },
  )

  it('fails closed when signing returns false', async () => {
    const options = successfulOptions({ sign: vi.fn(async () => false) })
    await expect(signAndNotarizeSeaBinary('/tmp/socket', options)).rejects.toThrow('signing was unavailable')
    expect(options.notarize).not.toHaveBeenCalled()
    expect(options.verifySignature).not.toHaveBeenCalled()
  })

  it('sanitizes signing failures before notarization or verification', async () => {
    const privateDetail = 'fixture signer credential detail'
    const options = successfulOptions({
      sign: vi.fn(async () => { throw new Error(privateDetail) }),
    })
    const rejection = await signAndNotarizeSeaBinary('/tmp/socket', options).then(
      () => undefined,
      error => error,
    )
    expect(rejection).toBeInstanceOf(Error)
    expect(String(rejection)).not.toContain(privateDetail)
    expect(options.sign).toHaveBeenCalledTimes(1)
    expect(options.notarize).not.toHaveBeenCalled()
    expect(options.verifySignature).not.toHaveBeenCalled()
  })

  it('fails closed when notarization does not return a receipt', async () => {
    const options = successfulOptions({ notarize: vi.fn(async () => false) })
    await expect(signAndNotarizeSeaBinary('/tmp/socket', options)).rejects.toThrow('accepted receipt')
    expect(options.verifySignature).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing, invalid, or non-accepted notary receipt', async () => {
    for (const receipt of [undefined, { ...notaryReceipt, status: 'In Progress' }, {
      ...notaryReceipt,
      submissionId: 'not-a-uuid',
    }]) {
      const options = successfulOptions({ notarize: vi.fn(async () => receipt) })
      await expect(signAndNotarizeSeaBinary('/tmp/socket', options)).rejects.toThrow('accepted receipt')
      expect(options.verifySignature).toHaveBeenCalledTimes(1)
    }
  })

  it('stops before notarization when signature verification fails', async () => {
    const privateDetail = 'fixture private verifier output'
    const options = successfulOptions({
      verifySignature: vi.fn(async () => { throw new Error(privateDetail) }),
    })
    const rejection = await signAndNotarizeSeaBinary('/tmp/socket', options).then(
      () => undefined,
      error => error,
    )
    expect(rejection).toBeInstanceOf(Error)
    expect(String(rejection)).not.toContain(privateDetail)
    expect(options.notarize).not.toHaveBeenCalled()
  })

  it('requires final signature evidence after notarization', async () => {
    const options = successfulOptions({
      verifySignature: vi.fn()
        .mockResolvedValueOnce(firstSignature)
        .mockRejectedValueOnce(new Error('private verifier output')),
    })
    await expect(signAndNotarizeSeaBinary('/tmp/socket', options)).rejects.toThrow(
      'Final code signature verification failed',
    )
    expect(options.notarize).toHaveBeenCalledTimes(1)
    expect(options.verifySignature).toHaveBeenCalledTimes(2)
  })

  it('sanitizes notarization failures and does not verify afterward', async () => {
    const options = successfulOptions({
      notarize: vi.fn(async () => { throw new Error('private credential details') }),
    })
    await expect(signAndNotarizeSeaBinary('/tmp/socket', options)).rejects.toThrow(
      'Apple notarization failed for the SEA binary.',
    )
    expect(options.verifySignature).toHaveBeenCalledTimes(1)
  })
})
