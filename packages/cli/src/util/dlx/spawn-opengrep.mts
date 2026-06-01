/**
 * Spawn OpenGrep for AST-based code-pattern scanning.
 *
 * - SpawnOpengrepDlx: download from GitHub releases, then exec.
 * - SpawnOpengrepVfs: extract from SEA bundle, then exec.
 * - SpawnOpengrep: auto-detect SEA vs npm-CLI mode and dispatch.
 *
 * Defined via `defineToolSpawn`. See util/dlx/define-tool-spawn.mts.
 */

import { defineToolSpawn } from "./define-tool-spawn.mts";
import { resolveOpengrep } from "./resolve-binary.mjs";

const triple = defineToolSpawn({
  toolName: "opengrep",
  vfsName: "opengrep",
  resolve: resolveOpengrep,
});

export const spawnOpengrepDlx = triple.Dlx;
export const spawnOpengrepVfs = triple.Vfs;
export const spawnOpengrep = triple.auto;
