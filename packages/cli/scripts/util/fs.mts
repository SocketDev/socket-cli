/**
 * @file File system utilities for build scripts.
 */

import { statSync } from "node:fs";
import path from "node:path";

/**
 * Find a file or directory by walking up parent directories. Similar to find-up
 * but synchronous and minimal.
 */
function findUpSync(name, options) {
  const opts = { __proto__: null, ...options };
  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- caller-overridable default; callers always pass a script-anchored cwd or accept the cwd they invoke from.
  const { cwd = process.cwd() } = opts;
  let { onlyDirectories = false, onlyFiles = true } = opts;
  if (onlyDirectories) {
    onlyFiles = false;
  }
  if (onlyFiles) {
    onlyDirectories = false;
  }
  let dir = path.resolve(cwd);
  const { root } = path.parse(dir);
  const names = [name].flat();
  // Search up to and including root directory.
  while (dir) {
    for (let i = 0, { length } = names; i < length; i += 1) {
      const name = names[i];
      const filePath = path.join(dir, name);
      try {
        const stats = statSync(filePath, { throwIfNoEntry: false });
        if (!onlyDirectories && stats?.isFile()) {
          return filePath;
        }
        if (!onlyFiles && stats?.isDirectory()) {
          return filePath;
        }
      } catch {}
    }
    // Stop after checking root directory.
    if (dir === root) {
      break;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}
