import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'

import { stripPnpmPeerSuffix } from './pnpm.mts'

export function idToPurl(id: string): string {
  return `pkg:npm/${id}`
}

export function resolvePackageVersion(purlObj: PackageURL): string {
  const { version } = purlObj
  return version
    ? (semver.coerce(stripPnpmPeerSuffix(version))?.version ?? '')
    : ''
}
