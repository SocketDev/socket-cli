import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { developerIdSign } from '../../../fleet/apple-sign.mts'
import type { DeveloperIdSignOptions } from '../../../fleet/apple-sign.mts'
import { notarizeMachO } from '../../../fleet/apple-notarize.mts'
import type { NotarizeCredentials } from '../../../fleet/apple-notarize.mts'
import { verifyAppleSignature } from '../../../fleet/registry/apple/signature.mts'
import type { AppleSignatureReceipt } from '../../../fleet/registry/apple/signature.mts'

export type SeaSigningReceipt = AppleSignatureReceipt & {
  submissionId: string
  notarizationStatus: 'Accepted'
}

export type SeaSignOptions = {
  appleTeamId?: string | undefined
  credentials?: NotarizeCredentials | undefined
  entitlementsPath?: string | undefined
  verifySignature?: typeof verifyAppleSignature | undefined
  sign?: typeof developerIdSign | undefined
  notarize?:
    | ((
        binaryPath: string,
        credentials?: NotarizeCredentials | undefined,
      ) => Promise<unknown>)
    | undefined
  platform?: NodeJS.Platform | undefined
}

type AcceptedNotarizationReceipt = {
  submissionId: string
  status: 'Accepted'
}

export async function signAndNotarizeSeaBinary(
  binaryPath: string,
  options: SeaSignOptions = {},
): Promise<SeaSigningReceipt> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    throw new Error('SEA signing and notarization require macOS.')
  }
  if (typeof binaryPath !== 'string' || binaryPath.trim().length === 0) {
    throw new Error('Missing SEA binary path.')
  }

  const appleTeamId = (
    options.appleTeamId ?? getEnvValue('APPLE_TEAM_ID')
  )?.trim()
  // Apple team identifiers contain ten uppercase letters or digits.
  if (!appleTeamId || !/^[A-Z0-9]{10}$/u.test(appleTeamId)) {
    throw new Error('Apple team identifier is invalid for the SEA binary.')
  }

  const sign = options.sign ?? developerIdSign
  const notarize = options.notarize ?? notarizeMachO
  const verifySignature = options.verifySignature ?? verifyAppleSignature
  const signed = await invokeSafely('Developer ID signing', () =>
    sign(binaryPath, {
      entitlementsPath: options.entitlementsPath,
      hardenedRuntime: true,
    } satisfies DeveloperIdSignOptions),
  )
  if (!signed) {
    throw new Error('Developer ID signing was unavailable for the SEA binary.')
  }

  await invokeSafely('Strict code signature verification', () =>
    verifySignature(binaryPath, appleTeamId, { platform }),
  )
  const notarized = await invokeSafely('Apple notarization', () =>
    notarize(binaryPath, options.credentials),
  )
  if (!isAcceptedNotarizationReceipt(notarized)) {
    throw new Error(
      'Apple notarization did not return an accepted receipt for the SEA binary.',
    )
  }
  const signature = await invokeSafely(
    'Final code signature verification',
    () => verifySignature(binaryPath, appleTeamId, { platform }),
  )
  return {
    ...signature,
    submissionId: notarized.submissionId,
    notarizationStatus: 'Accepted',
  }
}

async function invokeSafely<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch {
    throw new Error(`${label} failed for the SEA binary.`)
  }
}

function isAcceptedNotarizationReceipt(
  value: unknown,
): value is AcceptedNotarizationReceipt {
  if (!value || typeof value !== 'object') {
    return false
  }
  const receipt = value as Record<string, unknown>
  return (
    receipt['status'] === 'Accepted' &&
    typeof receipt['submissionId'] === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      receipt['submissionId'],
    )
  )
}
