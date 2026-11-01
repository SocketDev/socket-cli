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
    pathsById: new Map(),
    outputsByProject: new Map(),
    classpathsByProject: new Map(),
    directDependenciesByProject: new Map(),
  }
}

function mkComponentFixture(target: string): {
  facts: SocketFactsSbom
  paths: ResolvedArtifactPaths
} {
  const paths = emptyArtifactPaths()
  paths.pathsById.set('g:a:jar:1', { targets: [target] })
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
  it('carries only the classpaths when artifact paths were not resolved', () => {
    const facts: SocketFactsSbom = {
      projects: [
        {
          id: ':app',
          type: 'maven',
          namespace: 'g',
          name: 'app',
          subprojectDir: 'app',
          children: [0],
        },
      ],
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
    }
    const artifactPaths = emptyArtifactPaths()
    artifactPaths.classpathsByProject.set(
      ':app',
      new Map([['main', [{ id: 'g:a:jar:1' }]]]),
    )
    artifactPaths.directDependenciesByProject.set(':app', ['g:a:jar:1'])

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      facts,
      artifactPaths,
      '/root/.socket.facts.json',
      false,
    )
    const entry = serializeSidecar(acc)['/root/.socket.facts.json']!

    expect(entry.projects[0]).toEqual({
      id: ':app',
      type: 'maven',
      namespace: 'g',
      name: 'app',
      subprojectDir: 'app',
      dependencies: ['g:a:jar:1'],
      classpaths: { main: [{ id: 'g:a:jar:1' }] },
    })
    expect(entry.components[0]).toEqual(facts.components[0])
  })

  it('carries a component through with resolved targets attached, keyed by its own facts file', () => {
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
    artifactPaths.pathsById.set('com.example:lib:jar:da517db', {
      targets: ['/abs/lib.jar'],
    })

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
            sources: [],
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

  it("gives each sibling project's component that project's own output sets, even when they share a coordinate", () => {
    const util = {
      type: 'maven',
      namespace: 'ex',
      name: 'util',
      version: '1',
      children: [],
    }
    const facts: SocketFactsSbom = {
      components: [
        { ...util, id: ':a:util', firstParty: true },
        { ...util, id: ':b:util', firstParty: true },
      ],
      projects: [
        { ...util, id: ':a:util', subprojectDir: 'a/util' },
        { ...util, id: ':b:util', subprojectDir: 'b/util' },
      ],
    }
    const artifactPaths = emptyArtifactPaths()
    artifactPaths.outputsByProject.set(
      ':a:util',
      new Map([
        [
          'main',
          { sources: ['/abs/a/util/src'], targets: ['/abs/a/util/classes'] },
        ],
      ]),
    )
    artifactPaths.outputsByProject.set(
      ':b:util',
      new Map([
        [
          'main',
          { sources: ['/abs/b/util/src'], targets: ['/abs/b/util/classes'] },
        ],
      ]),
    )

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      facts,
      artifactPaths,
      '/root/gradle.socket.facts.json',
    )
    const entry = serializeSidecar(acc)['/root/gradle.socket.facts.json']!

    for (const entries of [entry.components, entry.projects]) {
      expect(
        Object.fromEntries(
          entries.map(e => [e.id, e.outputs?.['main']?.sources]),
        ),
      ).toEqual({
        ':a:util': ['/abs/a/util/src'],
        ':b:util': ['/abs/b/util/src'],
      })
    }
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
  })

  it('carries a first-party module (project, not a component) output sets, keyed by its own facts file', () => {
    const facts: SocketFactsSbom = {
      // The app module is a project but nothing depends on it, so it is absent
      // from components — its source roots must still reach the sidecar.
      components: [],
      projects: [
        {
          id: 'com.example:app:1.0',
          type: 'maven',
          namespace: 'com.example',
          name: 'app',
          version: '1.0',
          subprojectDir: 'app',
          children: [],
        },
      ],
    }
    const artifactPaths = emptyArtifactPaths()
    artifactPaths.outputsByProject.set(
      'com.example:app:1.0',
      new Map([
        [
          'main',
          {
            sources: ['/abs/app/src/main/java'],
            targets: ['/abs/app/classes'],
          },
        ],
        [
          'test',
          {
            sources: ['/abs/app/src/test/java'],
            targets: ['/abs/app/test-classes'],
          },
        ],
      ]),
    )

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(acc, facts, artifactPaths, '/root/app/.socket.facts.json')
    const resolved = serializeSidecar(acc)

    expect(resolved['/root/app/.socket.facts.json']!.components).toEqual([])
    expect(resolved['/root/app/.socket.facts.json']!.projects).toEqual([
      {
        id: 'com.example:app:1.0',
        type: 'maven',
        namespace: 'com.example',
        name: 'app',
        version: '1.0',
        subprojectDir: 'app',
        dependencies: [],
        outputs: {
          main: {
            sources: ['/abs/app/src/main/java'],
            targets: ['/abs/app/classes'],
          },
          test: {
            sources: ['/abs/app/src/test/java'],
            targets: ['/abs/app/test-classes'],
          },
        },
        classpaths: {},
      },
    ])
  })

  it('attaches each project its own classpaths, keyed by project id even within one directory', () => {
    const project = {
      type: 'maven',
      namespace: 'com.example',
      version: '1.0',
      children: [],
      subprojectDir: 'x',
    }
    const facts: SocketFactsSbom = {
      components: [],
      projects: [
        { ...project, id: 'x/a.xml', name: 'a' },
        { ...project, id: 'x/b.xml', name: 'b' },
      ],
    }
    const artifactPaths = emptyArtifactPaths()
    artifactPaths.classpathsByProject.set(
      'x/a.xml',
      new Map([['main', [{ id: 'g:x:jar:1' }]]]),
    )
    artifactPaths.classpathsByProject.set(
      'x/b.xml',
      new Map([['main', [{ id: 'g:x:jar:2' }]]]),
    )

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(acc, facts, artifactPaths, '/root/.socket.facts.json')
    const projects = serializeSidecar(acc)['/root/.socket.facts.json']!.projects

    expect(projects.map(p => p.classpaths)).toEqual([
      { main: [{ id: 'g:x:jar:1' }] },
      { main: [{ id: 'g:x:jar:2' }] },
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
          id: 'com.example:shared:1.0',
          type: 'maven',
          namespace: 'com.example',
          name: 'shared',
          version: '1.0',
          subprojectDir: '.',
          children: [],
        },
      ],
    }
    const pathsA = emptyArtifactPaths()
    pathsA.outputsByProject.set(
      'com.example:shared:1.0',
      new Map([['main', { sources: ['/root-a/src/main/java'], targets: [] }]]),
    )
    const pathsB = emptyArtifactPaths()
    pathsB.outputsByProject.set(
      'com.example:shared:1.0',
      new Map([['main', { sources: ['/root-b/src/main/java'], targets: [] }]]),
    )

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
      resolved['/root-a/.socket.facts.json']!.projects[0]!.outputs?.['main']
        ?.sources,
    ).toEqual(['/root-a/src/main/java'])
    expect(
      resolved['/root-b/.socket.facts.json']!.projects[0]!.outputs?.['main']
        ?.sources,
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
