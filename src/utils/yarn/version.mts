import { spawnSync } from '@socketsecurity/registry/lib/spawn'

import constants, { FLAG_VERSION } from '../../constants.mts'
import { getYarnBinPath } from '../yarn/paths.mts'

let _isYarnBerry: boolean | undefined
export function isYarnBerry(): boolean {
  if (_isYarnBerry === undefined) {
    try {
      const yarnBinPath = getYarnBinPath()
      const result = spawnSync(yarnBinPath, [FLAG_VERSION], {
        // On Windows, yarn is often a .cmd file that requires shell execution.
        // The spawn function from @socketsecurity/registry will handle this properly
        // when shell is true.
        shell: constants.WIN32,
      })

      if (result.status === 0 && result.stdout) {
        const version =
          typeof result.stdout === 'string'
            ? result.stdout
            : result.stdout.toString('utf8')
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
