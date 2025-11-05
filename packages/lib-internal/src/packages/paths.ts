/**
 * @fileoverview Package.json path resolution utilities.
 */

import { normalizePath } from '../path'

let _path: typeof import('path') | undefined
/**
 * Get the path module.
 */
/*@__NO_SIDE_EFFECTS__*/
function getPath() {
  if (_path === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _path = /*@__PURE__*/ require('node:path')
  }
  return _path as typeof import('path')
}

/**
 * Resolve directory path from a package.json file path.
 */
/*@__NO_SIDE_EFFECTS__*/
export function resolvePackageJsonDirname(filepath: string): string {
  if (filepath.endsWith('package.json')) {
    const path = getPath()
    return normalizePath(path.dirname(filepath))
  }
  return normalizePath(filepath)
}

/**
 * Resolve full path to package.json from a directory or file path.
 */
/*@__NO_SIDE_EFFECTS__*/
export function resolvePackageJsonPath(filepath: string): string {
  if (filepath.endsWith('package.json')) {
    return normalizePath(filepath)
  }
  const path = getPath()
  return normalizePath(path.join(filepath, 'package.json'))
}
