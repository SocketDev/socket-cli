import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import constants from '../../constants.mts'

import type { Agent } from '../../utils/package-environment.mts'

export type AgentLockIncludesFn = (
  lockSrc: string,
  name: string,
  ext?: string | undefined
) => boolean

const { BUN, LOCK_EXT, NPM, PNPM, VLT, YARN_BERRY, YARN_CLASSIC } = constants

function includesNpm(lockSrc: string, name: string) {
  // Detects the package name in the following cases:
  //   "name":
  return lockSrc.includes(`"${name}":`)
}

function includesBun(lockSrc: string, name: string, lockName?: string) {
  // This is a bit counterintuitive. When lockName ends with a .lockb
  // we treat it as a yarn.lock. When lockName ends with a .lock we
  // treat it as a package-lock.json. The bun.lock format is not identical
  // package-lock.json, however it close enough for npmLockIncludes to work.
  const lockfileScanner = lockName?.endsWith(LOCK_EXT)
    ? includesNpm
    : includesYarn
  return lockfileScanner(lockSrc, name)
}

function includesPnpm(lockSrc: string, name: string) {
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

function includesVlt(lockSrc: string, name: string) {
  // Detects the package name in the following cases:
  //   "name"
  return lockSrc.includes(`"${name}"`)
}

function includesYarn(lockSrc: string, name: string) {
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

export const lockfileIncludesByAgent = new Map<Agent, AgentLockIncludesFn>([
  [BUN, includesBun],
  [NPM, includesNpm],
  [PNPM, includesPnpm],
  [VLT, includesVlt],
  [YARN_BERRY, includesYarn],
  [YARN_CLASSIC, includesYarn]
])
