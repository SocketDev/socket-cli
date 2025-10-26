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

import { escapeRegExp } from '@socketsecurity/lib/regexps'
import { normalizePath } from '@socketsecurity/lib/path'

import { homePath } from '../../constants/paths.mts'

export function tildify(cwd: string) {
  // Normalize to forward slashes for consistent matching across platforms.
  const normalizedCwd = normalizePath(cwd)
  return normalizedCwd.replace(
    new RegExp(`^${escapeRegExp(homePath)}(?:/|$)`, 'i'),
    '~/',
  )
}
