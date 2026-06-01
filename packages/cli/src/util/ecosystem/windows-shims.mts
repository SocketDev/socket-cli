/**
 * Windows-shim resolution helpers extracted from `environment.mts` to keep that
 * file under the 1000-line File-size cap.
 *
 * On Windows, package-manager binaries (`npm`, `pnpm`, `yarn`) ship as either a
 * `.cmd` wrapper plus an extensionless shim or a direct `.js` entry point.
 * `resolveBinPathSync` finds the underlying JS file when given a shim;
 * `preferWindowsCmdShim` flips an extensionless path to its `.cmd` sibling when
 * one exists (so child_process can spawn it without `shell: true`).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { WIN32 } from "@socketsecurity/lib-stable/constants/platform";

/**
 * Given a bin path that might be an extensionless shim, return the matching
 * `.cmd` file when one exists in the same directory. Otherwise return the input
 * unchanged.
 *
 * Returns the input verbatim on POSIX, for non-absolute paths, when the path
 * already has an extension, or when its basename doesn't match `binName`
 * (defensive guard against accidentally turning a parent-directory path into a
 * shim).
 */
export function preferWindowsCmdShim(binPath: string, binName: string): string {
  if (!WIN32) {
    return binPath;
  }

  // Relative paths might be shell commands or aliases, not file paths.
  if (!path.isAbsolute(binPath)) {
    return binPath;
  }

  // Already has an extension (.exe / .bat / etc.) — assume a Windows binary.
  if (path.extname(binPath) !== "") {
    return binPath;
  }

  // Belt-and-suspenders: ensure binPath actually points to the named binary,
  // not a parent directory that happens to match.
  if (path.basename(binPath).toLowerCase() !== binName.toLowerCase()) {
    return binPath;
  }

  const cmdShim = path.join(path.dirname(binPath), `${binName}.cmd`);
  return existsSync(cmdShim) ? cmdShim : binPath;
}

/**
 * Resolve a bin path to its underlying JavaScript entry point if the file is an
 * npm/pnpm/yarn shim. Returns the input path unchanged when: - the file does
 * not exist - reading or parsing it throws - no shim pattern is recognized in
 * the file content.
 *
 * Used on Windows to resolve shims like `npm` or `npm.cmd` to their
 * `npm-cli.js` entry point so we can spawn them via Node directly.
 */
export function resolveBinPathSync(binPath: string): string {
  if (!existsSync(binPath)) {
    return binPath;
  }

  try {
    const content = readFileSync(binPath, "utf8");
    // Look for common shim patterns:
    //   node "C:\path\to\npm-cli.js" "$@"
    //   "%_prog%"  "%dp0%\node_modules\npm\bin\npm-cli.js" %*
    const nodePathMatch = content.match(
      /(?:"%dp0%\\|node\s+["'])([^"'\s]+(?:npm-cli|pnpm|yarn)\.(?:c?js|mjs))["'\s]/i,
    );
    if (nodePathMatch && nodePathMatch.length > 1 && nodePathMatch[1]) {
      const matchedPath = nodePathMatch[1];
      return path.isAbsolute(matchedPath)
        ? matchedPath
        : path.resolve(path.dirname(binPath), matchedPath);
    }
  } catch {
    // Unreadable/unparseable shim — fall through to the input path.
  }
  return binPath;
}
