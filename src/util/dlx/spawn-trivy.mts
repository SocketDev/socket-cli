import { defineGitHubReleaseSpawn } from './define-tool-spawn.mts'
import { resolveTrivy } from './resolve-binary.mjs'

export const spawnTrivy = defineGitHubReleaseSpawn({
  toolName: 'trivy',
  resolve: resolveTrivy,
})
