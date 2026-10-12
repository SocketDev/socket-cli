import { defineGitHubReleaseSpawn } from './define-tool-spawn.mts'
import { resolveTrivy } from './binary-resolution.mjs'

export const spawnTrivy = defineGitHubReleaseSpawn({
  toolName: 'trivy',
  resolve: resolveTrivy,
})
