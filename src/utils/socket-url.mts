import constants from '../constants.mts'

import type { PackageURL } from '@socketregistry/packageurl-js'
import type { components } from '@socketsecurity/sdk/types/api'

type PurlLikeType = PackageURL | components['schemas']['SocketPURL']

const { SOCKET_WEBSITE_URL } = constants

export function getPkgFullNameFromPurlObj(purlObj: PurlLikeType): string {
  const { name, namespace } = purlObj
  return namespace
    ? `${namespace}${purlObj.type === 'maven' ? ':' : '/'}${name}`
    : name
}

export function getSocketDevAlertUrl(alertType: string): string {
  return `${SOCKET_WEBSITE_URL}/alerts/${alertType}`
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
  const url = `${SOCKET_WEBSITE_URL}/${ecosystem}/package/${fullName}`
  return ecosystem === 'go'
    ? `${url}${version ? `?section=overview&version=${version}` : ''}`
    : `${url}${version ? `/overview/${version}` : ''}`
}
