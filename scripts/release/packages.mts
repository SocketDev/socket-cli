const nativeTargets = [
  'darwin-arm64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
]

export function nativePackageName(platform: string, arch: string): string {
  const target = `${platform}-${arch}`
  if (!nativeTargets.includes(target)) {
    throw new Error(`Unsupported native target: ${target}`)
  }
  return `@socketsecurity/socket-cli-${target}`
}

export function nativeOptionalDependencies(
  version: string,
): Record<string, string> {
  return Object.fromEntries(
    nativeTargets.map(target => [
      `@socketsecurity/socket-cli-${target}`,
      version,
    ]),
  )
}

export const RELEASE_PACKAGES = [
  'socket',
  '@socketsecurity/cli',
  '@socketsecurity/cli-with-sentry',
] as const

export function releasePackagesForVersion(version: string): readonly string[] {
  return version.includes('-')
    ? ['socket', ...Object.keys(nativeOptionalDependencies(version))]
    : RELEASE_PACKAGES
}
