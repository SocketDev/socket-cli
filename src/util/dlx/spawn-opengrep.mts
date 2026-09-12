import { defineGitHubReleaseSpawn } from './define-tool-spawn.mts'
import { resolveOpengrep } from './resolve-binary.mjs'

export const spawnOpengrep = defineGitHubReleaseSpawn({
  toolName: 'opengrep',
  resolve: resolveOpengrep,
})
