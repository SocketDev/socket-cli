import semver from '@socketsecurity/lib-stable/external/semver'

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
