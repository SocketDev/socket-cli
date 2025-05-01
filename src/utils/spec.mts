import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'

export function idToPurl(id: string): string {
  return `pkg:npm/${id}`
}

export function resolvePackageVersion(purlObj: PackageURL): string {
  const { version } = purlObj
  return version ? (semver.coerce(stripPeerSuffix(version))?.version ?? '') : ''
}

export function stripLeadingSlash(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}

export function stripPeerSuffix(depPath: string): string {
  const idx = depPath.indexOf('(')
  return idx === -1 ? depPath : depPath.slice(0, idx)
}
