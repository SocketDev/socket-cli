export const SEA_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-arm64-musl',
  'linux-x64',
  'linux-x64-musl',
  'win32-arm64',
  'win32-x64',
] as const

export function resolveSeaTarget(
  platform: string,
  arch: string,
  glibc?: string | undefined,
): string {
  const target = `${platform}-${arch}${platform === 'linux' && !glibc ? '-musl' : ''}`
  if (!(SEA_TARGETS as readonly string[]).includes(target)) {
    throw new Error(
      `Unsupported Socket platform: ${target}. Install on a supported arm64 or x64 platform.`,
    )
  }
  return target
}
