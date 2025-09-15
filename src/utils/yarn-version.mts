import { spawnSync } from '@socketsecurity/registry/lib/spawn'

import { getYarnBinPath } from './yarn-paths.mts'
import constants from '../constants.mts'

let _isYarnBerry: boolean | undefined
export function isYarnBerry(): boolean {
  if (_isYarnBerry === undefined) {
    try {
      const yarnBinPath = getYarnBinPath()
      const result = spawnSync(yarnBinPath, ['--version'], {
        encoding: 'utf8',
        shell: constants.WIN32
      })

      if (result.status === 0 && result.stdout) {
        const version = result.stdout
        // Yarn Berry starts from version 2.x
        const majorVersion = parseInt(version.split('.')[0]!, 10)
        _isYarnBerry = majorVersion >= 2
      } else {
        _isYarnBerry = false
      }
    } catch {
      _isYarnBerry = false
    }
  }
  return _isYarnBerry
}
