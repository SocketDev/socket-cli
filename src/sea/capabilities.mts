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
      'coana',
      ...(hasCdxgen ? ['manifest-cdxgen-npm-lock-v3'] : []),
      ...(hasCdxgen && hasSynp ? ['manifest-cdxgen-yarn-classic', 'synp'] : []),
      ...(hasUv ? ['uv'] : []),
    ],
    unavailable: [
      ...(hasCdxgen
        ? [
            {
              id: 'cdxgen-other-modes',
              reason:
                'The bundled cdxgen supports npm lockfile v3 and Yarn Classic with Synp.',
            },
          ]
        : [
            {
              id: 'cdxgen',
              reason: `No cdxgen API payload is embedded for ${triple}.`,
            },
          ]),
      ...(!hasCdxgen || !hasSynp
        ? [
            {
              id: 'synp',
              reason: `The Yarn Classic adapter is unavailable for ${triple}.`,
            },
          ]
        : []),
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
