import { describe, expect, it } from 'vitest'

import { accumulateSidecar, serializeSidecar } from './sidecar.mts'

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

function mkRootFixture(target: string): {
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
  it('emits the frozen ResolvedComponent[] contract', () => {
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
    accumulateSidecar(acc, facts, artifactPaths)
    const resolved = serializeSidecar(acc)

    expect(resolved).toEqual([
      {
        group: 'com.example',
        name: 'lib',
        version: 'da517db',
        ext: 'jar',
        classifier: null,
        targets: ['/abs/lib.jar'],
        sources: ['/abs/lib/src/main/java'],
      },
    ])
  })

  it('emits empty target/source arrays for a resolved-but-artifactless coord (pom/BOM)', () => {
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
    accumulateSidecar(acc, facts, emptyArtifactPaths())
    const resolved = serializeSidecar(acc)

    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.targets).toEqual([])
    expect(resolved[0]!.sources).toEqual([])
  })

  it('preserves a classifier qualifier and defaults it to null when absent', () => {
    const facts: SocketFactsSbom = {
      components: [
        {
          type: 'maven',
          namespace: 'g',
          name: 'a',
          version: '1',
          qualifiers: { ext: 'jar', classifier: 'sources' },
          id: 'g:a:jar:sources:1',
        },
      ],
    }
    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(acc, facts, emptyArtifactPaths())
    expect(serializeSidecar(acc)[0]!.classifier).toBe('sources')
  })

  it('carries a first-party module (project, not a component) source/target roots', () => {
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
    accumulateSidecar(acc, facts, artifactPaths)
    const resolved = serializeSidecar(acc)

    expect(resolved).toEqual([
      {
        group: 'com.example',
        name: 'app',
        version: '1.0',
        ext: '',
        classifier: null,
        targets: ['/abs/app/build/classes'],
        sources: ['/abs/app/src/main/java'],
      },
    ])
  })

  it('merges the same coordinate across build roots, unioning paths', () => {
    const acc: SidecarAccumulator = new Map()
    const a = mkRootFixture('/root-a/a.jar')
    const b = mkRootFixture('/root-b/a.jar')
    accumulateSidecar(acc, a.facts, a.paths)
    accumulateSidecar(acc, b.facts, b.paths)
    const resolved = serializeSidecar(acc)

    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.targets).toEqual(['/root-a/a.jar', '/root-b/a.jar'])
  })
})
