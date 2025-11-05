import {
  BUN,
  PNPM,
  VLT,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/lib-internal/constants/agents'
import { EXT_LOCK } from '@socketsecurity/lib-internal/constants/paths'
import { escapeRegExp } from '@socketsecurity/lib-internal/regexps'

import type { EnvDetails } from '../../utils/ecosystem/environment.mjs'

export function npmLockSrcIncludes(lockSrc: string, name: string) {
  // Detects the package name in the following cases:
  //   "name":
  return lockSrc.includes(`"${name}":`)
}

export function bunLockSrcIncludes(
  lockSrc: string,
  name: string,
  lockName?: string | undefined,
) {
  // This is a bit counterintuitive. When lockName ends with a .lockb
  // we treat it as a yarn.lock. When lockName ends with a .lock we
  // treat it as a package-lock.json. The bun.lock format is not identical
  // package-lock.json, however it close enough for npmLockIncludes to work.
  const lockfileScanner = lockName?.endsWith(EXT_LOCK)
    ? npmLockSrcIncludes
    : yarnLockSrcIncludes
  return lockfileScanner(lockSrc, name)
}

export function pnpmLockSrcIncludes(lockSrc: string, name: string) {
  const escapedName = escapeRegExp(name)
  return new RegExp(
    // Detects the package name.
    // v9.0 and v6.0 lockfile patterns:
    //   'name'
    //   name:
    //   name@
    // v6.0 lockfile patterns:
    //   /name@
    `(?<=^\\s*)(?:'${escapedName}'|/?${escapedName}(?=[:@]))`,
    'm',
  ).test(lockSrc)
}

export function vltLockSrcIncludes(lockSrc: string, name: string) {
  // Detects the package name in the following cases:
  //   "name"
  return lockSrc.includes(`"${name}"`)
}

export function yarnLockSrcIncludes(lockSrc: string, name: string) {
  const escapedName = escapeRegExp(name)
  return new RegExp(
    // Detects the package name in the following cases:
    //   "name@
    //   , "name@
    //   name@
    //   , name@
    `(?<=(?:^\\s*|,\\s*)"?)${escapedName}(?=@)`,
    'm',
  ).test(lockSrc)
}

export function lockSrcIncludes(
  pkgEnvDetails: EnvDetails,
  lockSrc: string,
  name: string,
  lockName?: string | undefined,
): boolean {
  switch (pkgEnvDetails.agent) {
    case BUN:
      return bunLockSrcIncludes(lockSrc, name, lockName)
    case PNPM:
      return pnpmLockSrcIncludes(lockSrc, name)
    case VLT:
      return vltLockSrcIncludes(lockSrc, name)
    case YARN_BERRY:
      return yarnLockSrcIncludes(lockSrc, name)
    case YARN_CLASSIC:
      return yarnLockSrcIncludes(lockSrc, name)
    default:
      return npmLockSrcIncludes(lockSrc, name)
  }
}
