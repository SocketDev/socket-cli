/**
 * Spawn TruffleHog for secret-scanning runs.
 *
 * - spawnTrufflehogDlx: download from GitHub releases, then exec.
 * - spawnTrufflehogVfs: extract from SEA bundle, then exec.
 * - spawnTrufflehog: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * Defined via `defineToolSpawn`. See util/dlx/define-tool-spawn.mts.
 */

import { defineToolSpawn } from './define-tool-spawn.mts'
import { resolveTrufflehog } from './resolve-binary.mjs'

const triple = defineToolSpawn({
  toolName: 'trufflehog',
  vfsName: 'trufflehog',
  resolve: resolveTrufflehog,
})

export const spawnTrufflehogDlx = triple.Dlx
export const spawnTrufflehogVfs = triple.Vfs
export const spawnTrufflehog = triple.auto
