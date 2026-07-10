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
        ecosystem: 'maven',
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
        ecosystem: 'maven',
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

describe('nuget (dotnet) sidecar entries', () => {
  it('tags dotnet facts entries with ecosystem and keeps them separate from maven', () => {
    const acc: SidecarAccumulator = new Map()

    const dotnetFacts = {
      metadata: {
        format: 'socket-facts-sbom' as const,
        tool: 'dotnet' as const,
        toolVersion: '8.0.414',
      },
      components: [
        {
          type: 'nuget',
          name: 'Newtonsoft.Json',
          version: '13.0.3',
          id: 'Newtonsoft.Json:13.0.3',
          direct: true,
        },
      ],
      projects: [
        {
          type: 'nuget',
          name: 'MyApp',
          version: '1.0.0',
          subprojectDir: 'MyApp',
          dependencies: ['Newtonsoft.Json:13.0.3'],
          resolvedAs: [],
        },
      ],
    }
    const dotnetPaths = {
      targetsByCoord: new Map([
        [
          'Newtonsoft.Json:13.0.3',
          ['/nuget/newtonsoft.json/13.0.3/lib/net6.0/Newtonsoft.Json.dll'],
        ],
        ['MyApp:1.0.0', ['/repo/MyApp/bin/Debug/net8.0/MyApp.dll']],
      ]),
      targetsByGav: new Map<string, string[]>(),
      sourcesByCoord: new Map([['MyApp:1.0.0', ['/repo/MyApp']]]),
      coords: new Set(['Newtonsoft.Json:13.0.3', 'MyApp:1.0.0']),
    }
    accumulateSidecar(acc, dotnetFacts, dotnetPaths)

    // A maven artifact that would key identically without the ecosystem
    // namespace (groupless, ext-less) must not merge with the nuget entry.
    const mavenFacts = {
      metadata: {
        format: 'socket-facts-sbom' as const,
        tool: 'gradle' as const,
        toolVersion: '8.0',
      },
      components: [
        {
          type: 'maven',
          namespace: '',
          name: 'Newtonsoft.Json',
          version: '13.0.3',
          id: 'Newtonsoft.Json:13.0.3',
        },
      ],
    }
    const mavenPaths = {
      targetsByCoord: new Map([['Newtonsoft.Json:13.0.3', ['/m2/weird.jar']]]),
      targetsByGav: new Map<string, string[]>(),
      sourcesByCoord: new Map<string, string[]>(),
      coords: new Set(['Newtonsoft.Json:13.0.3']),
    }
    accumulateSidecar(acc, mavenFacts, mavenPaths)

    const resolved = serializeSidecar(acc)
    expect(resolved).toHaveLength(3)

    const nugetPkg = resolved.find(
      c => c.ecosystem === 'nuget' && c.name === 'Newtonsoft.Json',
    )
    expect(nugetPkg).toMatchObject({
      group: '',
      version: '13.0.3',
      ext: '',
      classifier: null,
      targets: ['/nuget/newtonsoft.json/13.0.3/lib/net6.0/Newtonsoft.Json.dll'],
      sources: [],
    })

    const nugetProject = resolved.find(
      c => c.ecosystem === 'nuget' && c.name === 'MyApp',
    )
    expect(nugetProject).toMatchObject({
      targets: ['/repo/MyApp/bin/Debug/net8.0/MyApp.dll'],
      sources: ['/repo/MyApp'],
    })

    // The maven entry is explicitly tagged 'maven' (strict producer) and keyed
    // separately from the same-coordinate nuget entry — no cross-ecosystem merge.
    const mavenPkg = resolved.find(
      c => c.ecosystem === 'maven' && c.name === 'Newtonsoft.Json',
    )
    expect(mavenPkg).toMatchObject({
      ecosystem: 'maven',
      name: 'Newtonsoft.Json',
      targets: ['/m2/weird.jar'],
    })
  })
})
