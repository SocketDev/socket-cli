/**
 * Socket.dev URL utilities for Socket CLI.
 * Generates URLs for Socket.dev website features and resources.
 *
 * Key Functions:
 * - getPkgFullNameFromPurl: Extract full package name from PURL
 * - getSocketDevAlertUrl: Generate alert type documentation URL
 * - getSocketDevPackageOverviewUrl: Generate package overview URL
 * - getSocketDevPackageOverviewUrlFromPurl: Generate overview URL from PURL
 * - getSocketDevPackageUrl: Generate package detail URL
 * - getSocketDevPackageUrlFromPurl: Generate package URL from PURL
 * - getSocketDevReportUrl: Generate scan report URL
 *
 * URL Generation:
 * - Package overview and detail pages
 * - Security alert documentation
 * - Scan report links
 * - Ecosystem-specific URL formatting
 */

import type { PackageURL } from '@socketregistry/packageurl-js'
import { SOCKET_WEBSITE_URL } from '../../constants/socket.mjs'

import type { SocketArtifact } from '../alert/artifact.mts'
import type { PURL_Type } from '../ecosystem/ecosystem.mjs'
import { getPurlObject } from '../purl/parse.mts'

export function getPkgFullNameFromPurl(
  purl: string | PackageURL | SocketArtifact,
): string {
  const purlObj = getPurlObject(purl)
  const { name, namespace } = purlObj
  return namespace
    ? `${namespace}${purlObj.type === 'maven' ? ':' : '/'}${name}`
    : name!
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
