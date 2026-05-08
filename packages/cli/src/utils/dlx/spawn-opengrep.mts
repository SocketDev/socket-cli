/**
 * Spawn OpenGrep for AST-based code-pattern scanning.
 *
 * - spawnOpengrepDlx: download from GitHub releases, then exec.
 * - spawnOpengrepVfs: extract from SEA bundle, then exec.
 * - spawnOpengrep: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * Defined via `defineToolSpawn`. See utils/dlx/define-tool-spawn.mts.
 */

import { defineToolSpawn } from './define-tool-spawn.mts'
import { resolveOpengrep } from './resolve-binary.mjs'

const triple = defineToolSpawn({
  toolName: 'opengrep',
  vfsName: 'opengrep',
  resolve: resolveOpengrep,
})

export const spawnOpengrepDlx = triple.Dlx
export const spawnOpengrepVfs = triple.Vfs
export const spawnOpengrep = triple.auto
