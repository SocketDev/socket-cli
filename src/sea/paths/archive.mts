export const SEA_RESOURCES_DIRECTORY = 'resources'
export const SEA_CAPABILITIES_PATH = `${SEA_RESOURCES_DIRECTORY}/capabilities.json`

export function seaArchivePaths(rootFiles: readonly string[]): string[] {
  return ['dist', 'external', ...rootFiles, SEA_RESOURCES_DIRECTORY, 'tools']
}
