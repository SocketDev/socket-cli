export const RELEASE_PACKAGES = [
  'socket',
  '@socketsecurity/cli',
  '@socketsecurity/cli-with-sentry',
] as const

export function releasePackagesForVersion(version: string): readonly string[] {
  return version.includes('-') ? ['socket'] : RELEASE_PACKAGES
}
