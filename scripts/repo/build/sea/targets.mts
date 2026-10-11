import { PACK_APP_TRIPLETS } from '../../../fleet/util/pack-app-triplets.mts'

export const SEA_TARGETS = PACK_APP_TRIPLETS

export function resolveSeaTarget(
  platform: string,
  arch: string,
  options?: { glibc?: string | undefined } | undefined,
): string {
  const { glibc } = { __proto__: null, ...options }
  const target = `${platform}-${arch}${platform === 'linux' && !glibc ? '-musl' : ''}`
  if (!(SEA_TARGETS as readonly string[]).includes(target)) {
    throw new Error(
      `Unsupported Socket platform: ${target}. Install on a supported arm64 or x64 platform.`,
    )
  }
  return target
}
