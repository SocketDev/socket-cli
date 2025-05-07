import type { PackageURL } from '@socketregistry/packageurl-js'
import type { components } from '@socketsecurity/sdk/types/api'

type PurlLikeType = PackageURL | components['schemas']['SocketPURL']

export function getPkgFullNameFromPurlObj(purlObj: PurlLikeType): string {
  const { name, namespace } = purlObj
  return namespace
    ? `${namespace}${purlObj.type === 'maven' ? ':' : '/'}${name}`
    : name
}

export function getSocketDevAlertUrl(alertType: string): string {
  return `https://socket.dev/alerts/${alertType}`
}

export function getSocketDevPackageOverviewUrlFromPurl(
  purlObj: PurlLikeType
): string {
  const fullName = getPkgFullNameFromPurlObj(purlObj)
  return getSocketDevPackageOverviewUrl(purlObj.type, fullName, purlObj.version)
}

export function getSocketDevPackageOverviewUrl(
  ecosystem: string,
  fullName: string,
  version?: string | undefined
): string {
  if (ecosystem === 'go') {
    return `https://socket.dev/go/package/${fullName}${version ? `?section=overview&version=${version}` : ''}`
  } else {
    return `https://socket.dev/${ecosystem}/package/${fullName}${version ? `/overview/${version}` : ''}`
  }
}
