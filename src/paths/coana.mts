import path from 'node:path'

export const COANA_CACHE_FILENAME = 'coana-cache.mjs'
export const COANA_CACHE_SOURCE_PATH = `vendor/${COANA_CACHE_FILENAME}`

export function coanaCacheDistPath(distDirectory: string): string {
  return path.join(distDirectory, COANA_CACHE_FILENAME)
}

export const COANA_CLI_WRAPPER_FILENAME = 'cli-wrapper.mjs'

export function coanaCliWrapperPath(cliDirectory: string): string {
  return path.join(cliDirectory, COANA_CLI_WRAPPER_FILENAME)
}
