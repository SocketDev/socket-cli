import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { FLAG_VERSION } from '../../constants/cli.mts'
import { getYarnBinPathDetails } from '../yarn/paths.mts'

let cachedIsYarnBerry: boolean | undefined
export function isYarnBerry(): boolean {
  if (cachedIsYarnBerry === undefined) {
    try {
      // Detection must degrade to `false` when yarn is absent or is only
      // reachable through a project-controlled bin directory. getYarnBinPath()
      // calls process.exit(127) in that case, which no catch block can trap.
      const yarnBinPath = getYarnBinPathDetails().path
      if (!yarnBinPath) {
        cachedIsYarnBerry = false
        return cachedIsYarnBerry
      }
      const result = spawnSync(yarnBinPath, [FLAG_VERSION], {
        // On Windows, yarn is often a .cmd file that requires shell execution.
        // The spawn function from @socketsecurity/registry will handle this properly
        // when shell is true.
        shell: WIN32,
      })

      if (result.status === 0 && result.stdout) {
        const version = result.stdout
        // Yarn Berry starts from version 2.x
        const parts = version.trim().split('.')
        const majorVersion =
          parts.length > 0 && parts[0] && /^\d+$/.test(parts[0])
            ? Number.parseInt(parts[0], 10)
            : 0
        cachedIsYarnBerry = majorVersion >= 2
      } else {
        cachedIsYarnBerry = false
      }
    } catch {
      cachedIsYarnBerry = false
    }
  }
  return cachedIsYarnBerry
}
