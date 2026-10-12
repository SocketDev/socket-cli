import { defineGitHubReleaseSpawn } from './define-tool-spawn.mts'
import { resolveOpengrep } from './binary-resolution.mjs'

export const spawnOpengrep = defineGitHubReleaseSpawn({
  toolName: 'opengrep',
  resolve: resolveOpengrep,
})
