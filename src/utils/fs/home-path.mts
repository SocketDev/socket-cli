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

import { homePath } from '../../constants/paths.mts'

export function tildify(cwd: string) {
  return cwd.replace(
    new RegExp(`^${escapeRegExp(homePath)}(?:${path.sep}|$)`, 'i'),
    '~/',
  )
}
