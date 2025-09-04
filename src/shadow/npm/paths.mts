import path from 'node:path'

import { normalizePath } from '@socketsecurity/registry/lib/path'

import constants from '../../constants.mts'
import { getNpmRequire } from '../../utils/npm-paths.mts'

let _arboristPkgPath: string | undefined
export function getArboristPackagePath() {
  if (_arboristPkgPath === undefined) {
    const pkgName = '@npmcli/arborist'
    const mainPathWithForwardSlashes = normalizePath(
      getNpmRequire().resolve(pkgName),
    )
    const arboristPkgPathWithForwardSlashes = mainPathWithForwardSlashes.slice(
      0,
      mainPathWithForwardSlashes.lastIndexOf(pkgName) + pkgName.length,
    )
    _arboristPkgPath = constants.WIN32
      ? path.normalize(arboristPkgPathWithForwardSlashes)
      : arboristPkgPathWithForwardSlashes
  }
  return _arboristPkgPath
}

let _arboristClassPath: string | undefined
export function getArboristClassPath() {
  if (_arboristClassPath === undefined) {
    _arboristClassPath = path.join(
      getArboristPackagePath(),
      'lib/arborist/index.js',
    )
  }
  return _arboristClassPath
}

let _arboristEdgeClassPath: string | undefined
export function getArboristEdgeClassPath() {
  if (_arboristEdgeClassPath === undefined) {
    _arboristEdgeClassPath = path.join(getArboristPackagePath(), 'lib/edge.js')
  }
  return _arboristEdgeClassPath
}

let _arboristNodeClassPath: string | undefined
export function getArboristNodeClassPath() {
  if (_arboristNodeClassPath === undefined) {
    _arboristNodeClassPath = path.join(getArboristPackagePath(), 'lib/node.js')
  }
  return _arboristNodeClassPath
}

let _arboristOverrideSetClassPath: string | undefined
export function getArboristOverrideSetClassPath() {
  if (_arboristOverrideSetClassPath === undefined) {
    _arboristOverrideSetClassPath = path.join(
      getArboristPackagePath(),
      'lib/override-set.js',
    )
  }
  return _arboristOverrideSetClassPath
}
