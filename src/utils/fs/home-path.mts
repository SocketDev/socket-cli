/**
 * Path tildification utilities for Socket CLI.
 * Abbreviates home directory paths with tilde notation.
 *
 * Key Functions:
 * - tildify: Replace home directory with ~ in paths
 *
 * Usage:
 * - Shortens absolute paths for display
 * - Converts /Users/name/... to ~/...
 * - Common Unix convention for home directory
 */

import path from 'node:path'

import { escapeRegExp } from '@socketsecurity/registry/lib/regexps'

import constants from '../../constants.mjs'

export function tildify(cwd: string) {
  return cwd.replace(
    new RegExp(`^${escapeRegExp(constants.homePath)}(?:${path.sep}|$)`, 'i'),
    '~/',
  )
}
