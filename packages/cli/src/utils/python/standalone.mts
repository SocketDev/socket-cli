/**
 * @fileoverview Python runtime management for Socket CLI.
 *
 * This module re-exports the Python CLI spawning functionality from the unified
 * DLX spawn utilities. Both socket-basics and socketcli use the same Python runtime.
 *
 * Resolution Order:
 * 1. SOCKET_CLI_PYCLI_LOCAL_PATH environment variable (local development)
 * 2. Bundled Python from SEA VFS (SEA binary installations)
 * 3. Portable Python download via DLX (npm/pnpm/yarn installations)
 *
 * See also:
 *   - DLX spawn utilities: src/utils/dlx/spawn.mts
 *   - Socket basics VFS extraction: src/utils/basics/vfs-extract.mts
 *   - SEA detection: src/utils/sea/detect.mts
 */

// Re-export the unified Python CLI utilities from DLX spawn utilities.
export {
  ensurePython,
  ensurePythonDlx,
  ensureSocketPyCli,
  spawnSocketPyCli,
} from '../dlx/spawn.mts'

export type { SocketPyCliDlxOptions } from '../dlx/spawn.mts'
