import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import type { SpawnStdioResult } from '@socketsecurity/lib-stable/process/spawn/types'
import {
  developerIdSign,
  type DeveloperIdSignOptions,
} from '../../../fleet/apple-sign.mts'
import {
  notarizeMachO,
  type NotarizeCredentials,
} from '../../../fleet/apple-notarize.mts'

export type SeaSignSpawn = (
  command: string,
  args: string[],
  options: { stdio: 'pipe'; timeout: number },
) => Promise<SpawnStdioResult>

export type SeaSignOptions = {
  credentials?: NotarizeCredentials | undefined
  entitlementsPath?: string | undefined
  spawnProcess?: SeaSignSpawn
  sign?: typeof developerIdSign
  notarize?: typeof notarizeMachO
  platform?: NodeJS.Platform
}

export async function signAndNotarizeSeaBinary(
  binaryPath: string,
  options: SeaSignOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    throw new Error('SEA signing and notarization require macOS.')
  }
  if (!binaryPath.trim()) {
    throw new Error('Missing SEA binary path.')
  }

  const sign = options.sign ?? developerIdSign
  const notarize = options.notarize ?? notarizeMachO
  const signed = await invokeSafely('Developer ID signing', () =>
    sign(binaryPath, {
      entitlementsPath: options.entitlementsPath,
      hardenedRuntime: true,
    } satisfies DeveloperIdSignOptions),
  )
  if (!signed) {
    throw new Error('Developer ID signing was unavailable for the SEA binary.')
  }

  const spawnProcess = options.spawnProcess ?? spawn
  await verifySignature(spawnProcess, binaryPath)
  const notarized = await invokeSafely('Apple notarization', () =>
    notarize(binaryPath, options.credentials),
  )
  if (!notarized) {
    throw new Error('Apple notarization was unavailable for the SEA binary.')
  }
  await verifySignature(spawnProcess, binaryPath)
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

async function verifySignature(
  spawnProcess: SeaSignSpawn,
  binaryPath: string,
): Promise<void> {
  try {
    const result = await spawnProcess(
      'codesign',
      ['--verify', '--strict', binaryPath],
      { stdio: 'pipe', timeout: 30_000 },
    )
    if (result.code !== 0) {
      throw new Error('Signature verification returned a nonzero exit code.')
    }
  } catch {
    throw new Error(
      'Strict code signature verification failed for the SEA binary.',
    )
  }
}
