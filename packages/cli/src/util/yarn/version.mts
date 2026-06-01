import { WIN32 } from "@socketsecurity/lib-stable/constants/platform";
import { spawnSync } from "@socketsecurity/lib-stable/process/spawn/child";

import { FLAG_VERSION } from "../../constants/cli.mts";
import { getYarnBinPath } from "../yarn/paths.mts";

let cachedIsYarnBerry: boolean | undefined;
export function isYarnBerry(): boolean {
  if (cachedIsYarnBerry === undefined) {
    try {
      const yarnBinPath = getYarnBinPath();
      const result = spawnSync(yarnBinPath, [FLAG_VERSION], {
        // On Windows, yarn is often a .cmd file that requires shell execution.
        // The spawn function from @socketsecurity/registry will handle this properly
        // when shell is true.
        shell: WIN32,
      });

      if (result.status === 0 && result.stdout) {
        const version = result.stdout;
        // Yarn Berry starts from version 2.x
        const parts = version.trim().split(".");
        const majorVersion =
          parts.length > 0 && parts[0] && /^\d+$/.test(parts[0])
            ? Number.parseInt(parts[0], 10)
            : 0;
        cachedIsYarnBerry = majorVersion >= 2;
      } else {
        cachedIsYarnBerry = false;
      }
    } catch {
      cachedIsYarnBerry = false;
    }
  }
  return cachedIsYarnBerry;
}
