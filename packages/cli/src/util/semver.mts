import semver from 'semver'

import type { SemVer } from 'semver'

export const RangeStyles = ['pin', 'preserve']

export type RangeStyle = 'pin' | 'preserve'

export type { SemVer }

export function getMajor(version: unknown): number | undefined {
  try {
    const coerced = semver.coerce(version as string)
    return coerced ? semver.major(coerced) : undefined
  } catch {}
  return undefined
}

export function getMinVersion(range: unknown): SemVer | undefined {
  try {
    return semver.minVersion(range as string) ?? undefined
  } catch {}
  return undefined
}
