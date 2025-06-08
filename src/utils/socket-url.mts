import constants from '../constants.mts'
import { getPurlObject } from './purl.mts'

import type { PURL_Type, SocketArtifact } from './alert/artifact.mts'
import type { PackageURL } from '@socketregistry/packageurl-js'

const { SOCKET_WEBSITE_URL } = constants

export function getPkgFullNameFromPurl(
  purl: string | PackageURL | SocketArtifact,
): string {
  const purlObj = getPurlObject(purl)
  const { name, namespace } = purlObj
  return namespace
    ? `${namespace}${purlObj.type === 'maven' ? ':' : '/'}${name}`
    : name
}

export function getSocketDevAlertUrl(alertType: string): string {
  return `${SOCKET_WEBSITE_URL}/alerts/${alertType}`
}

export function getSocketDevPackageOverviewUrlFromPurl(
  purl: string | PackageURL | SocketArtifact,
): string {
  const purlObj = getPurlObject(purl)
  const fullName = getPkgFullNameFromPurl(purlObj)
  return getSocketDevPackageOverviewUrl(purlObj.type, fullName, purlObj.version)
}

export function getSocketDevPackageOverviewUrl(
  ecosystem: PURL_Type,
  fullName: string,
  version?: string | undefined,
): string {
  const url = `${SOCKET_WEBSITE_URL}/${ecosystem}/package/${fullName}`
  return ecosystem === 'golang'
    ? `${url}${version ? `?section=overview&version=${version}` : ''}`
    : `${url}${version ? `/overview/${version}` : ''}`
}
