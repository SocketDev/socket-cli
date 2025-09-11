import semver from 'semver'

import type { SemVer } from 'semver'

export const RangeStyles = ['pin', 'preserve']

export type RangeStyle = 'pin' | 'preserve'

export type { SemVer }

export function getMajor(version: unknown): number | null {
  try {
    const coerced = semver.coerce(version as string)
    return coerced ? semver.major(coerced) : null
  } catch {}
  return null
}

export function getMinVersion(range: unknown): SemVer | null {
  try {
    return semver.minVersion(range as string)
  } catch {}
  return null
}
