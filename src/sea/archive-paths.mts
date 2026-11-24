export function seaArchivePaths({
  hasCdxgen,
  hasCoana = false,
  hasSynp,
  hasUv,
  rootFiles,
}: {
  hasCdxgen: boolean
  hasCoana?: boolean
  hasSynp: boolean
  hasUv: boolean
  rootFiles: string[]
}): string[] {
  return [
    'dist',
    'external',
    ...rootFiles,
    'resources',
    ...(hasCdxgen || hasCoana || hasSynp || hasUv ? ['tools'] : []),
  ]
}
