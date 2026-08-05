import { describe, expect, it } from 'vitest'

import {
  accumulateSidecar,
  hasResolvedPathsSidecarEntries,
  hasSidecarEntries,
  mergeResolvedPathsSidecars,
  serializeSidecar,
} from './sidecar.mts'

import type { ResolvedArtifactPaths, SocketFactsSbom } from './facts.mts'
import type { SidecarAccumulator } from './sidecar.mts'

function emptyArtifactPaths(): ResolvedArtifactPaths {
  return {
    targetsByCoord: new Map(),
    targetsByGav: new Map(),
    sourcesByCoord: new Map(),
    coords: new Set(),
  }
}

function mkComponentFixture(target: string): {
  facts: SocketFactsSbom
  paths: ResolvedArtifactPaths
} {
  const paths = emptyArtifactPaths()
  paths.targetsByCoord.set('g:a:jar:1', [target])
  return {
    facts: {
      components: [
        {
          type: 'maven',
          namespace: 'g',
          name: 'a',
          version: '1',
          qualifiers: { ext: 'jar' },
          id: 'g:a:jar:1',
        },
      ],
    },
    paths,
  }
}

describe('compute-artifacts sidecar', () => {
  it('carries a component through with resolved targets/sources attached, keyed by its own facts file', () => {
    const facts: SocketFactsSbom = {
      components: [
        {
          type: 'maven',
          namespace: 'com.example',
          name: 'lib',
          version: 'da517db',
          qualifiers: { ext: 'jar' },
          id: 'com.example:lib:jar:da517db',
        },
      ],
    }
    const artifactPaths = emptyArtifactPaths()
    artifactPaths.targetsByCoord.set('com.example:lib:jar:da517db', [
      '/abs/lib.jar',
    ])
    artifactPaths.sourcesByCoord.set('com.example:lib:jar:da517db', [
      '/abs/lib/src/main/java',
    ])

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(acc, facts, artifactPaths, '/root/.socket.facts.json')
    const resolved = serializeSidecar(acc)

    expect(resolved).toEqual({
      '/root/.socket.facts.json': {
        projects: [],
        components: [
          {
            type: 'maven',
            namespace: 'com.example',
            name: 'lib',
            version: 'da517db',
            qualifiers: { ext: 'jar' },
            id: 'com.example:lib:jar:da517db',
            targets: ['/abs/lib.jar'],
            sources: ['/abs/lib/src/main/java'],
          },
        ],
      },
    })
  })

  it('emits explicit empty targets/sources for a resolved-but-artifactless coord (pom/BOM) - [] means resolved, not "not resolved"', () => {
    const facts: SocketFactsSbom = {
      components: [
        {
          type: 'maven',
          namespace: 'com.example',
          name: 'bom',
          version: '1.0',
          qualifiers: { ext: 'pom' },
          id: 'com.example:bom:pom:1.0',
        },
      ],
    }
    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      facts,
      emptyArtifactPaths(),
      '/root/.socket.facts.json',
    )
    const resolved = serializeSidecar(acc)

    const entry = resolved['/root/.socket.facts.json']!.components[0]!
    expect(entry.targets).toEqual([])
    expect(entry.sources).toEqual([])
  })

  it('leaves targets/sources undefined (not []) when the entry has no computable coordinate at all', () => {
    const facts: SocketFactsSbom = {
      components: [
        { type: 'maven', namespace: '', name: '', id: 'degenerate' },
      ],
    }
    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      facts,
      emptyArtifactPaths(),
      '/root/.socket.facts.json',
    )
    const entry =
      serializeSidecar(acc)['/root/.socket.facts.json']!.components[0]!
    expect(entry.targets).toBeUndefined()
    expect(entry.sources).toBeUndefined()
  })

  it('preserves the original component fields (id, qualifiers) untouched', () => {
    const facts: SocketFactsSbom = {
      components: [
        {
          type: 'maven',
          namespace: 'g',
          name: 'a',
          version: '1',
          qualifiers: { ext: 'jar', classifier: 'sources' },
          id: 'g:a:jar:sources:1',
          direct: true,
          dependencies: ['x'],
        },
      ],
    }
    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      facts,
      emptyArtifactPaths(),
      '/root/.socket.facts.json',
    )
    const entry =
      serializeSidecar(acc)['/root/.socket.facts.json']!.components[0]!
    expect(entry.qualifiers?.['classifier']).toBe('sources')
    expect(entry.id).toBe('g:a:jar:sources:1')
    expect(entry.direct).toBe(true)
    expect(entry.dependencies).toEqual(['x'])
  })

  it('carries a first-party module (project, not a component) source/target roots, keyed by its own facts file', () => {
    const facts: SocketFactsSbom = {
      // The app module is a project but nothing depends on it, so it is absent
      // from components — its source roots must still reach the sidecar.
      components: [],
      projects: [
        {
          type: 'maven',
          namespace: 'com.example',
          name: 'app',
          version: '1.0',
          subprojectDir: 'app',
          dependencies: [],
          resolvedAs: [],
        },
      ],
    }
    const artifactPaths = emptyArtifactPaths()
    artifactPaths.sourcesByCoord.set('com.example:app:1.0', [
      '/abs/app/src/main/java',
    ])
    artifactPaths.targetsByCoord.set('com.example:app:1.0', [
      '/abs/app/build/classes',
    ])

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(acc, facts, artifactPaths, '/root/app/.socket.facts.json')
    const resolved = serializeSidecar(acc)

    expect(resolved['/root/app/.socket.facts.json']!.components).toEqual([])
    expect(resolved['/root/app/.socket.facts.json']!.projects).toEqual([
      {
        type: 'maven',
        namespace: 'com.example',
        name: 'app',
        version: '1.0',
        subprojectDir: 'app',
        dependencies: [],
        resolvedAs: [],
        targets: ['/abs/app/build/classes'],
        sources: ['/abs/app/src/main/java'],
      },
    ])
  })

  it('does NOT reunion the same external coordinate across build roots - duplication across reactors is intentional', () => {
    const acc: SidecarAccumulator = new Map()
    const a = mkComponentFixture('/root-a/a.jar')
    const b = mkComponentFixture('/root-b/a.jar')
    accumulateSidecar(acc, a.facts, a.paths, '/root-a/.socket.facts.json')
    accumulateSidecar(acc, b.facts, b.paths, '/root-b/.socket.facts.json')
    const resolved = serializeSidecar(acc)

    expect(
      resolved['/root-a/.socket.facts.json']!.components[0]!.targets,
    ).toEqual(['/root-a/a.jar'])
    expect(
      resolved['/root-b/.socket.facts.json']!.components[0]!.targets,
    ).toEqual(['/root-b/a.jar'])
  })

  it('keeps first-party modules from two independent roots fully separate, even with the same purl identity', () => {
    const sharedModuleFacts: SocketFactsSbom = {
      components: [],
      projects: [
        {
          type: 'maven',
          namespace: 'com.example',
          name: 'shared',
          version: '1.0',
          subprojectDir: '.',
          dependencies: [],
          resolvedAs: [],
        },
      ],
    }
    const pathsA = emptyArtifactPaths()
    pathsA.sourcesByCoord.set('com.example:shared:1.0', [
      '/root-a/src/main/java',
    ])
    const pathsB = emptyArtifactPaths()
    pathsB.sourcesByCoord.set('com.example:shared:1.0', [
      '/root-b/src/main/java',
    ])

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      sharedModuleFacts,
      pathsA,
      '/root-a/.socket.facts.json',
    )
    accumulateSidecar(
      acc,
      sharedModuleFacts,
      pathsB,
      '/root-b/.socket.facts.json',
    )
    const resolved = serializeSidecar(acc)

    expect(Object.keys(resolved)).toEqual([
      '/root-a/.socket.facts.json',
      '/root-b/.socket.facts.json',
    ])
    expect(
      resolved['/root-a/.socket.facts.json']!.projects[0]!.sources,
    ).toEqual(['/root-a/src/main/java'])
    expect(
      resolved['/root-b/.socket.facts.json']!.projects[0]!.sources,
    ).toEqual(['/root-b/src/main/java'])
  })

  it('hasSidecarEntries reports empty until a facts file is accumulated', () => {
    const acc: SidecarAccumulator = new Map()
    expect(hasSidecarEntries(acc)).toBe(false)

    accumulateSidecar(
      acc,
      { components: [] },
      emptyArtifactPaths(),
      '/root/.socket.facts.json',
    )
    expect(hasSidecarEntries(acc)).toBe(true)
  })

  it('mergeResolvedPathsSidecars unions distinct facts-file keys from two already-serialized sidecars', () => {
    const accA: SidecarAccumulator = new Map()
    accumulateSidecar(
      accA,
      { components: [] },
      emptyArtifactPaths(),
      '/root-a/.socket.facts.json',
    )
    const sidecarA = serializeSidecar(accA)

    const accB: SidecarAccumulator = new Map()
    accumulateSidecar(
      accB,
      { components: [] },
      emptyArtifactPaths(),
      '/root-b/.socket.facts.json',
    )
    const sidecarB = serializeSidecar(accB)

    const merged = mergeResolvedPathsSidecars(sidecarA, sidecarB)

    expect(Object.keys(merged)).toEqual([
      '/root-a/.socket.facts.json',
      '/root-b/.socket.facts.json',
    ])
    expect(hasResolvedPathsSidecarEntries(merged)).toBe(true)
  })

  it('hasResolvedPathsSidecarEntries reports false for a wholly empty sidecar', () => {
    expect(hasResolvedPathsSidecarEntries({})).toBe(false)
  })
})
