/**
 * Path tildification utilities for Socket CLI.
 * Abbreviates home directory paths with tilde notation.
 *
 * Key Functions:
 * - tildify: Replace home directory with ~ in paths
 *
 * Usage:
 * - Shortens absolute paths for display
 * - Converts absolute home paths to ~/...
 * - Common Unix convention for home directory
 */

import path from 'node:path'

import { escapeRegExp } from '@socketsecurity/lib/regexps'

import { homePath } from '../../constants/paths.mts'

export function tildify(cwd: string) {
  // On Windows, accept both forward and back slashes as separators
  // since paths can be mixed (Git Bash, WSL, etc.).
  const sepPattern = path.sep === '\\' ? '[\\\\/]' : '/'
  return cwd.replace(
    new RegExp(`^${escapeRegExp(homePath)}(?:${sepPattern}|$)`, 'i'),
    '~/',
  )
}
