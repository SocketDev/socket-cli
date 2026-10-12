import { defineGitHubReleaseSpawn } from './define-tool-spawn.mts'
import { resolveTrufflehog } from './binary-resolution.mjs'

export const spawnTrufflehog = defineGitHubReleaseSpawn({
  toolName: 'trufflehog',
  resolve: resolveTrufflehog,
})
