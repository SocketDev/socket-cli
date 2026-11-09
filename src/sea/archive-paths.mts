export function seaArchivePaths({
  hasCdxgen,
  hasSynp,
  hasUv,
  rootFiles,
}: {
  hasCdxgen: boolean
  hasSynp: boolean
  hasUv: boolean
  rootFiles: string[]
}): string[] {
  return [
    'dist',
    'external',
    ...rootFiles,
    'resources',
    ...(hasCdxgen || hasSynp || hasUv ? ['tools'] : []),
  ]
}
