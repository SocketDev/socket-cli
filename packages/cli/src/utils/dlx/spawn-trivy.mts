/**
 * Spawn Trivy for image / IaC vulnerability scanning.
 *
 * - spawnTrivyDlx: download from GitHub releases, then exec.
 * - spawnTrivyVfs: extract from SEA bundle, then exec.
 * - spawnTrivy: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * Defined via `defineToolSpawn`. See utils/dlx/define-tool-spawn.mts.
 */

import { defineToolSpawn } from './define-tool-spawn.mts'
import { resolveTrivy } from './resolve-binary.mjs'

const triple = defineToolSpawn({
  toolName: 'trivy',
  vfsName: 'trivy',
  resolve: resolveTrivy,
})

export const spawnTrivyDlx = triple.Dlx
export const spawnTrivyVfs = triple.Vfs
export const spawnTrivy = triple.auto
