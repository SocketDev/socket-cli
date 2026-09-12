// lib-stable 6.0.9 doesn't publish ./external/semver; semver is bundled at
// build so no runtime dep leaks.
// oxlint-disable-next-line socket/prefer-lib-versions-over-semver -- bundled
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
