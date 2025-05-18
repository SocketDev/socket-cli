import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'

export function idToPurl(id: string): string {
  return `pkg:npm/${id}`
}

export function isDepPath(maybeDepPath: string): boolean {
  return maybeDepPath.length > 0 && maybeDepPath.charCodeAt(0) === 47 /*'/'*/
}

export function resolvePackageVersion(purlObj: PackageURL): string {
  const { version } = purlObj
  return version ? (semver.coerce(stripPeerSuffix(version))?.version ?? '') : ''
}

export function stripLeadingSlash(depPath: string): string {
  return isDepPath(depPath) ? depPath.slice(1) : depPath
}

export function stripPeerSuffix(depPath: string): string {
  const index = depPath.indexOf('(')
  return index === -1 ? depPath : depPath.slice(0, index)
}
