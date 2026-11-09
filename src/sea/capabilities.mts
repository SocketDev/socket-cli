export type SeaCapability = { id: string } | { id: string; reason: string }

export type SeaCapabilities = {
  available: string[]
  unavailable: Array<{ id: string; reason: string }>
}

export function createSeaCapabilities({
  hasCdxgen,
  hasSocketPatch,
  hasSynp,
  hasUv,
  socketPatchVersion,
  triple,
}: {
  triple: string
  hasCdxgen: boolean
  hasSynp: boolean
  hasSocketPatch: boolean
  hasUv: boolean
  socketPatchVersion?: string
}): SeaCapabilities {
  return {
    available: [
      'socket-core',
      'manifest-dotnet-facts',
      ...(hasSocketPatch ? ['socket-patch'] : []),
      ...(hasUv ? ['uv'] : []),
    ],
    unavailable: [
      ...(hasCdxgen
        ? [
            {
              id: 'manifest-cdxgen-npm-lock-v3',
              reason:
                'The restricted npm lock v3 path passed local command smoke, but installed Rollup module bytes are not authenticated against the frozen package tarballs or generated bundle. See the explicitly unverified source inventory.',
            },
            {
              id: 'cdxgen-other-modes',
              reason:
                'Only one npm package-lock.json v3 project is implemented; other project types and modes are not included.',
            },
            {
              id: 'manifest-cdxgen-yarn-classic',
              reason:
                'Synp v1.9.14 API conversion and cdxgen package-lock v1 API smoke passed, but Synp Rollup provenance remains unauthenticated and its third-party notice inventory has missing-license-text obligations.',
            },
          ]
        : [
            {
              id: 'cdxgen',
              reason: `No cdxgen API payload is embedded for ${triple}; only darwin-arm64 has a qualified VFS bundle.`,
            },
          ]),
      {
        id: 'synp',
        reason: hasSynp
          ? 'The Synp API is bundled for Yarn Classic, but source provenance remains unverified and its third-party notice inventory has missing-license-text obligations.'
          : 'No Synp API payload is embedded because no compatible cdxgen VFS API payload is available for this target.',
      },
      {
        id: 'coana',
        reason:
          'No Coana executable or verified payload is embedded in this core SEA build.',
      },
      ...(!hasSocketPatch
        ? [
            {
              id: 'socket-patch',
              reason: `No compatible locked socket-patch package was validated for ${triple}${socketPatchVersion ? ` at ${socketPatchVersion}` : ''}.`,
            },
          ]
        : []),
      {
        id: 'python',
        reason:
          'No relocatable Python runtime and standard library are embedded in this core SEA build.',
      },
      {
        id: 'jvm-toolchain',
        reason:
          'No JVM runtime or toolchain payload is embedded in this core SEA build.',
      },
      ...(!hasSocketPatch
        ? [
            {
              id: 'native-assets',
              reason:
                'No separately verified native tool assets are embedded in this core SEA build.',
            },
          ]
        : []),
    ],
  }
}
