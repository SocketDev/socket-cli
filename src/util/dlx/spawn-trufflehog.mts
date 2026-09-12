import { defineGitHubReleaseSpawn } from './define-tool-spawn.mts'
import { resolveTrufflehog } from './resolve-binary.mjs'

export const spawnTrufflehog = defineGitHubReleaseSpawn({
  toolName: 'trufflehog',
  resolve: resolveTrufflehog,
})
