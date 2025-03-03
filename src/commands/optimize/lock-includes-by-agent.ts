import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import constants from '../../constants'

import type { Agent } from '../../utils/package-environment-detector'

export type AgentLockIncludesFn = (
  lockSrc: string,
  name: string,
  ext?: string | undefined
) => boolean

const { BUN, LOCK_EXT, NPM, PNPM, VLT, YARN_BERRY, YARN_CLASSIC } = constants

function lockIncludesNpm(lockSrc: string, name: string) {
  // Detects the package name in the following cases:
  //   "name":
  return lockSrc.includes(`"${name}":`)
}

function lockIncludesBun(lockSrc: string, name: string, lockName?: string) {
  // This is a bit counterintuitive. When lockName ends with a .lockb
  // we treat it as a yarn.lock. When lockName ends with a .lock we
  // treat it as a package-lock.json. The bun.lock format is not identical
  // package-lock.json, however it close enough for npmLockIncludes to work.
  const lockScanner = lockName?.endsWith(LOCK_EXT)
    ? lockIncludesNpm
    : lockIncludesYarn
  return lockScanner(lockSrc, name)
}

function lockIncludesPnpm(lockSrc: string, name: string) {
  const escapedName = escapeRegExp(name)
  return new RegExp(
    // Detects the package name in the following cases:
    //   /name/
    //   'name'
    //   name:
    //   name@
    `(?<=^\\s*)(?:(['/])${escapedName}\\1|${escapedName}(?=[:@]))`,
    'm'
  ).test(lockSrc)
}

function lockIncludesVlt(lockSrc: string, name: string) {
  // Detects the package name in the following cases:
  //   "name"
  return lockSrc.includes(`"${name}"`)
}

function lockIncludesYarn(lockSrc: string, name: string) {
  const escapedName = escapeRegExp(name)
  return new RegExp(
    // Detects the package name in the following cases:
    //   "name@
    //   , "name@
    //   name@
    //   , name@
    `(?<=(?:^\\s*|,\\s*)"?)${escapedName}(?=@)`,
    'm'
  ).test(lockSrc)
}

export const lockIncludesByAgent = new Map<Agent, AgentLockIncludesFn>([
  [BUN, lockIncludesBun],
  [NPM, lockIncludesNpm],
  [PNPM, lockIncludesPnpm],
  [VLT, lockIncludesVlt],
  [YARN_BERRY, lockIncludesYarn],
  [YARN_CLASSIC, lockIncludesYarn]
])
