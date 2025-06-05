import path from 'node:path'

import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import constants from '../constants.mts'

// Replace the start of a path with ~/ when it starts with your home dir.
// A common way to abbreviate the user home dir (though not strictly posix).
export function tildify(cwd: string) {
  return cwd.replace(
    new RegExp(`^${escapeRegExp(constants.homePath)}(?:${path.sep}|$)`, 'i'),
    '~/',
  )
}
