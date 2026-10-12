import { describe, expect, it } from 'vitest'

import { assembleFacts } from './assemble.mts'
import { parseRecords } from './records.mts'
import { accumulateSidecar, serializeSidecar } from './sidecar.mts'

import type { SocketFactsSbom } from './facts.mts'
import type { SidecarAccumulator } from './sidecar.mts'

// Each project's tree, written out with component ids; a repeat on the current
// path (a cycle) is written without its children.
function trees(facts: SocketFactsSbom): Record<string, string[]> {
  const deps = facts.dependencies ?? []
  const render = (i: number, path: number[]): string => {
    const id = facts.components[deps[i]!.component]!.id
    const children = deps[i]!.children ?? []
    if (path.includes(i) || !children.length) {
      return id
    }
    return `${id}(${children.map(c => render(c, [...path, i])).join(', ')})`
  }
  return Object.fromEntries(
    (facts.projects ?? []).map(p => [p.id, p.children.map(i => render(i, []))]),
  )
}

// Minimal line-protocol records for a one-module Gradle build (--with-files):
// - first-party module `:app` (a project, NOT a dependency node) with source +
//   output roots,
// - an external dep `lib` resolved to a jar,
// - a `bom` resolved as a constraints-only artifact (no file).
const RECORDS = [
  'meta\tgradle\t8.0\t17',
  'project\t:app\tcom.example\tapp\t1.0\t/abs/app',
  'projectSrc\t:app\t/abs/app/src/main/java',
  'projectTgt\t:app\t/abs/app/build/classes',
  'root\tr1\t:app\truntimeClasspath\t1',
  'node\tr1\tcom.example:lib:jar:1.0\tcom.example\tlib\t1.0\tjar\t\t1',
  'node\tr1\tcom.example:bom:2.0\tcom.example\tbom\t2.0\t\t\t1',
  'file\tr1\tcom.example:lib:jar:1.0\t/abs/lib.jar',
  'scanned\truntimeClasspath',
].join('\n')

function chain(root: string, project: string, version: string): string[] {
  return [
    `root\t${root}\t${project}\tcompile\t1`,
    `node\t${root}\tg:lib:jar:1\tg\tlib\t1\tjar\t\t1`,
    `node\t${root}\tg:mid:jar:1\tg\tmid\t1\tjar\t\t0`,
    `node\t${root}\tg:dep:jar:${version}\tg\tdep\t${version}\tjar\t\t0`,
    `edge\t${root}\tg:lib:jar:1\tg:mid:jar:1`,
    `edge\t${root}\tg:mid:jar:1\tg:dep:jar:${version}`,
  ]
}

function cycle(root: string, project: string, extra: boolean): string[] {
  return [
    `root\t${root}\t${project}\tcompile\t1`,
    `node\t${root}\tg:x:jar:1\tg\tx\t1\tjar\t\t1`,
    `node\t${root}\tg:y:jar:1\tg\ty\t1\tjar\t\t0`,
    `edge\t${root}\tg:x:jar:1\tg:y:jar:1`,
    `edge\t${root}\tg:y:jar:1\tg:x:jar:1`,
    ...(extra
      ? [
          `node\t${root}\tg:z:jar:1\tg\tz\t1\tjar\t\t0`,
          `edge\t${root}\tg:y:jar:1\tg:z:jar:1`,
        ]
      : []),
  ]
}

describe('records → assemble → sidecar', () => {
  it('carries first-party project paths, external jars, and artifactless BOMs', () => {
    // Inject fileExists so the synthetic absolute paths aren't filtered out.
    const { artifactPaths, facts } = assembleFacts(parseRecords(RECORDS), {
      fileExists: () => true,
    })

    expect(facts.metadata?.tool).toBe('gradle')
    expect(facts.metadata?.javaVersion).toBe('17')
    // contentHash/schemaVersion are intentionally absent from metadata.
    expect(facts.metadata).not.toHaveProperty('contentHash')
    expect(facts.metadata).not.toHaveProperty('schemaVersion')

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(acc, facts, artifactPaths, '/abs/.socket.facts.json')
    const resolved = serializeSidecar(acc)
    const bucket = resolved['/abs/.socket.facts.json']!
    const byName = new Map(bucket.components.map(r => [r.name, r]))

    // First-party module: project-only (not a node), yet its source/output
    // roots reach the sidecar, keyed by its own facts file.
    expect(bucket.projects).toEqual([
      {
        id: ':app',
        type: 'maven',
        namespace: 'com.example',
        name: 'app',
        version: '1.0',
        subprojectDir: '/abs/app',
        dependencies: ['com.example:bom:2.0', 'com.example:lib:jar:1.0'],
        targets: ['/abs/app/build/classes'],
        sources: ['/abs/app/src/main/java'],
        classpath: ['com.example:bom:2.0', 'com.example:lib:jar:1.0'],
      },
    ])

    // External dependency: jar target, empty (not undefined) sources - it was
    // resolved, it just has no first-party source roots.
    expect(byName.get('lib')?.targets).toEqual(['/abs/lib.jar'])
    expect(byName.get('lib')?.sources).toEqual([])

    // Artifactless BOM: present with explicit empty arrays (resolved, no
    // artifact) - [] means resolved-and-empty, not "not resolved".
    const bom = byName.get('bom')
    expect(bom?.targets).toEqual([])
    expect(bom?.sources).toEqual([])
  })
  it('keeps a coordinate with divergent subtrees as one component with a dependency entry per subtree', () => {
    // :a and :b both depend on `lib`, which pulls a different `dep` version in
    // each subproject.
    const records = [
      'meta\tgradle\t8.0\t17',
      'project\t:a\tcom.example\ta\t1.0\ta',
      'project\t:b\tcom.example\tb\t1.0\tb',
      'root\tr1\t:a\truntimeClasspath\t1',
      'node\tr1\tg:lib:jar:1\tg\tlib\t1\tjar\t\t1',
      'node\tr1\tg:dep:jar:1\tg\tdep\t1\tjar\t\t0',
      'edge\tr1\tg:lib:jar:1\tg:dep:jar:1',
      'root\tr2\t:b\truntimeClasspath\t1',
      'node\tr2\tg:lib:jar:1\tg\tlib\t1\tjar\t\t1',
      'node\tr2\tg:dep:jar:2\tg\tdep\t2\tjar\t\t0',
      'edge\tr2\tg:lib:jar:1\tg:dep:jar:2',
      'root\tr3\t:b\ttestRuntimeClasspath\t0',
      'node\tr3\tg:junit:jar:4\tg\tjunit\t4\tjar\t\t1',
    ].join('\n')
    const { artifactPaths, facts } = assembleFacts(parseRecords(records), {
      fileExists: () => true,
    })

    expect(facts.components.map(c => c.id)).toEqual([
      'g:dep:jar:1',
      'g:dep:jar:2',
      'g:junit:jar:4',
      'g:lib:jar:1',
    ])
    expect(facts.components[3]).not.toHaveProperty('dependencies')
    expect(facts.dependencies).toEqual([
      { component: 0 },
      { component: 3, children: [0] },
      { component: 2 },
      { component: 1 },
      { component: 3, children: [3] },
    ])
    expect(trees(facts)).toEqual({
      ':a': ['g:lib:jar:1(g:dep:jar:1)'],
      ':b': ['g:junit:jar:4', 'g:lib:jar:1(g:dep:jar:2)'],
    })

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(acc, facts, artifactPaths, '/abs/.socket.facts.json')
    const byName = new Map(
      serializeSidecar(acc)['/abs/.socket.facts.json']!.projects.map(p => [
        p.name,
        p,
      ]),
    )
    expect(byName.get('a')?.classpath).toEqual(['g:dep:jar:1', 'g:lib:jar:1'])
    expect(byName.get('b')?.classpath).toEqual([
      'g:dep:jar:2',
      'g:junit:jar:4',
      'g:lib:jar:1',
    ])
    expect(byName.get('b')?.dependencies).toEqual([
      'g:junit:jar:4',
      'g:lib:jar:1',
    ])
    expect(byName.get('b')).not.toHaveProperty('children')
  })
  it('shares one dependency entry between identical subtrees across subprojects', () => {
    const records = [
      'meta\tmaven\t3.9.6\t17',
      'project\ta\tg\ta\t1\ta',
      'project\tb\tg\tb\t1\tb',
      'root\tr1\ta\tcompile\t1',
      'node\tr1\tg:lib:jar:1\tg\tlib\t1\tjar\t\t1',
      'node\tr1\tg:dep:jar:1\tg\tdep\t1\tjar\t\t0',
      'edge\tr1\tg:lib:jar:1\tg:dep:jar:1',
      'root\tr2\tb\tcompile\t1',
      'node\tr2\tg:other:jar:1\tg\tother\t1\tjar\t\t1',
      'node\tr2\tg:lib:jar:1\tg\tlib\t1\tjar\t\t0',
      'node\tr2\tg:dep:jar:1\tg\tdep\t1\tjar\t\t0',
      'edge\tr2\tg:other:jar:1\tg:lib:jar:1',
      'edge\tr2\tg:lib:jar:1\tg:dep:jar:1',
    ].join('\n')
    const { facts } = assembleFacts(parseRecords(records))

    expect(facts.dependencies).toHaveLength(3)
    expect(trees(facts)).toEqual({
      a: ['g:lib:jar:1(g:dep:jar:1)'],
      b: ['g:other:jar:1(g:lib:jar:1(g:dep:jar:1))'],
    })
  })
  it('tells apart subtrees that differ only further down', () => {
    const records = [
      'meta\tmaven\t3.9.6\t17',
      'project\ta\tg\ta\t1\ta',
      'project\tb\tg\tb\t1\tb',
      ...chain('r1', 'a', '1'),
      ...chain('r2', 'b', '2'),
    ].join('\n')
    const { facts } = assembleFacts(parseRecords(records))

    expect(trees(facts)).toEqual({
      a: ['g:lib:jar:1(g:mid:jar:1(g:dep:jar:1))'],
      b: ['g:lib:jar:1(g:mid:jar:1(g:dep:jar:2))'],
    })
  })
  it('merges the configurations of a subproject into one tree', () => {
    const records = [
      'meta\tgradle\t8.0\t17',
      'project\t:a\tg\ta\t1\ta',
      'root\tr1\t:a\tcompileClasspath\t1',
      'node\tr1\tg:lib:jar:1\tg\tlib\t1\tjar\t\t1',
      'node\tr1\tg:api:jar:1\tg\tapi\t1\tjar\t\t0',
      'edge\tr1\tg:lib:jar:1\tg:api:jar:1',
      'root\tr2\t:a\truntimeClasspath\t1',
      'node\tr2\tg:lib:jar:1\tg\tlib\t1\tjar\t\t1',
      'node\tr2\tg:api:jar:1\tg\tapi\t1\tjar\t\t0',
      'node\tr2\tg:impl:jar:1\tg\timpl\t1\tjar\t\t0',
      'edge\tr2\tg:lib:jar:1\tg:api:jar:1',
      'edge\tr2\tg:lib:jar:1\tg:impl:jar:1',
    ].join('\n')
    const { facts } = assembleFacts(parseRecords(records))

    expect(trees(facts)).toEqual({
      ':a': ['g:lib:jar:1(g:api:jar:1, g:impl:jar:1)'],
    })
  })
  it('merges equal cycles and keeps different ones apart', () => {
    const records = [
      'meta\tsbt\t1.10.7\t17',
      'project\ta\tg\ta\t1\ta',
      'project\tb\tg\tb\t1\tb',
      'project\tc\tg\tc\t1\tc',
      ...cycle('r1', 'a', false),
      ...cycle('r2', 'b', false),
      ...cycle('r3', 'c', true),
    ].join('\n')
    const { facts } = assembleFacts(parseRecords(records))

    // x and y once for a and b together, and once more for c, plus z.
    expect(facts.dependencies).toHaveLength(5)
    const [a, b, c] = facts.projects!
    expect(a!.children).toEqual(b!.children)
    expect(c!.children).not.toEqual(a!.children)
    expect(trees(facts)).toEqual({
      a: ['g:x:jar:1(g:y:jar:1(g:x:jar:1))'],
      b: ['g:x:jar:1(g:y:jar:1(g:x:jar:1))'],
      c: ['g:x:jar:1(g:y:jar:1(g:z:jar:1, g:x:jar:1))'],
    })
  })
  it('rejects a resolved dependency that no direct dependency reaches', () => {
    const records = [
      'meta\tsbt\t1.10.7\t17',
      'project\ta\tg\ta\t1\ta',
      'root\tr1\ta\tcompile\t1',
      'node\tr1\tg:lib:jar:1\tg\tlib\t1\tjar\t\t1',
      'node\tr1\tg:loose:jar:1\tg\tloose\t1\tjar\t\t0',
      'node\tr1\tg:dep:jar:1\tg\tdep\t1\tjar\t\t0',
      'edge\tr1\tg:loose:jar:1\tg:dep:jar:1',
    ].join('\n')

    expect(() => assembleFacts(parseRecords(records))).toThrow(
      'Resolved dependencies of a are not reachable from its direct dependencies: g:dep:jar:1, g:loose:jar:1',
    )
  })
  it("gives a dependency on a build project that project's id, and marks only it firstParty", () => {
    const records = [
      'meta\tgradle\t8.0\t17',
      'project\t:a\tg\ta\t1.0-SNAPSHOT\ta',
      'project\t:b\tg\tb\t1.0-SNAPSHOT\tb',
      'root\tr1\t:a\truntimeClasspath\t1',
      'node\tr1\tg:ext:jar:2\tg\text\t2\tjar\t\t1\t',
      'root\tr2\t:b\truntimeClasspath\t1',
      'node\tr2\tg:a:jar:1.0-SNAPSHOT\tg\ta\t1.0-SNAPSHOT\tjar\t\t1\t:a',
      'node\tr2\tg:ext:jar:2\tg\text\t2\tjar\t\t0\t',
      'edge\tr2\tg:a:jar:1.0-SNAPSHOT\tg:ext:jar:2',
      // Same name as a build project, but a published artifact, not the project.
      'node\tr2\tg:b:jar:0.9\tg\tb\t0.9\tjar\t\t1\t',
    ].join('\n')
    const { artifactPaths, facts } = assembleFacts(parseRecords(records))

    expect(facts.components.map(c => [c.id, c.firstParty ?? 'absent'])).toEqual(
      [
        [':a', true],
        ['g:b:jar:0.9', 'absent'],
        ['g:ext:jar:2', 'absent'],
      ],
    )
    expect(trees(facts)).toEqual({
      ':a': ['g:ext:jar:2'],
      ':b': [':a(g:ext:jar:2)', 'g:b:jar:0.9'],
    })

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      facts,
      artifactPaths,
      '/abs/gradle.socket.facts.json',
    )
    const bucket = serializeSidecar(acc)['/abs/gradle.socket.facts.json']!
    expect(bucket.components.find(c => c.id === ':a')?.firstParty).toBe(true)
    for (const project of bucket.projects) {
      expect(project).not.toHaveProperty('firstParty')
    }
  })
  it("keeps projects that share a coordinate apart, collapsing each project's variants into it", () => {
    const records = [
      'meta\tgradle\t8.0\t17',
      'project\t:a:util\tex\tutil\t1\ta/util',
      'projectSrc\t:a:util\t/abs/a/util/src',
      'project\t:b:util\tex\tutil\t1\tb/util',
      'projectSrc\t:b:util\t/abs/b/util/src',
      'project\t:app\tex\tapp\t1\tapp',
      'root\tr1\t:app\truntimeClasspath\t1',
      'node\tr1\tex:util:jar:1\tex\tutil\t1\tjar\t\t1\t:b:util',
      'node\tr1\tex:util:jar:test-fixtures:1\tex\tutil\t1\tjar\ttest-fixtures\t1\t:b:util',
      'node\tr1\tg:ext:jar:2\tg\text\t2\tjar\t\t0\t',
      'edge\tr1\tex:util:jar:test-fixtures:1\tex:util:jar:1',
      'edge\tr1\tex:util:jar:1\tg:ext:jar:2',
      'root\tr2\t:b:util\truntimeClasspath\t1',
      'node\tr2\tex:util:jar:1\tex\tutil\t1\tjar\t\t1\t:a:util',
    ].join('\n')
    const { artifactPaths, facts } = assembleFacts(parseRecords(records), {
      fileExists: () => true,
    })

    expect(facts.components.map(c => [c.id, c.qualifiers])).toEqual([
      [':a:util', undefined],
      [':b:util', undefined],
      ['g:ext:jar:2', { ext: 'jar' }],
    ])
    expect(trees(facts)).toEqual({
      ':a:util': [],
      ':app': [':b:util(g:ext:jar:2)'],
      ':b:util': [':a:util'],
    })
    expect(artifactPaths.classpathByProject.get(':app')).toEqual([
      ':b:util',
      'g:ext:jar:2',
    ])
    expect(artifactPaths.classpathByProject.get(':b:util')).toEqual([':a:util'])
    expect(artifactPaths.pathsById.get(':a:util')?.sources).toEqual([
      '/abs/a/util/src',
    ])
    expect(artifactPaths.pathsById.get(':b:util')?.sources).toEqual([
      '/abs/b/util/src',
    ])
  })

  it('marks each subproject with its own build files and no component with any', () => {
    const records = [
      'meta\tmaven\t3.9.6\t17',
      'project\ta\tg\ta\t1\ta',
      'projectBuild\ta\ta/pom.xml',
      'project\tb\tg\tb\t1\tb',
      'projectBuild\tb\tb/pom.xml',
      // No build file of its own, e.g. configured from the root build.
      'project\tc\tg\tc\t1\tc',
      'root\tr1\ta\truntimeClasspath\t1',
      'node\tr1\tg:ext:jar:2\tg\text\t2\tjar\t\t1',
      'node\tr1\tg:dep:jar:3\tg\tdep\t3\tjar\t\t0',
      'edge\tr1\tg:ext:jar:2\tg:dep:jar:3',
      'root\tr2\tb\ttestRuntimeClasspath\t0',
      'node\tr2\tg:a:jar:1\tg\ta\t1\tjar\t\t1',
      'node\tr2\tg:ext:jar:2\tg\text\t2\tjar\t\t1',
      'edge\tr2\tg:a:jar:1\tg:ext:jar:2',
      'root\tr3\tc\truntimeClasspath\t1',
      'node\tr3\tg:solo:jar:1\tg\tsolo\t1\tjar\t\t1',
    ].join('\n')
    const { facts } = assembleFacts(parseRecords(records))

    expect(
      Object.fromEntries(
        facts.projects!.map(p => [p.name, p.manifestFiles ?? 'absent']),
      ),
    ).toEqual({
      a: [{ file: 'a/pom.xml' }],
      b: [{ file: 'b/pom.xml' }],
      c: 'absent',
    })
    for (const c of facts.components) {
      expect(c).not.toHaveProperty('manifestFiles')
    }
  })
  it("records each project's own build files, relative to the build root", () => {
    const records = [
      'meta\tmaven\t3.9.6\t17',
      'buildRoot\t/repo/sub',
      'project\tg:agg:1\tg\tagg\t1\t.',
      'projectBuild\tg:agg:1\tother-pom.xml',
      'project\tg:mod-a:1\tg\tmod-a\t1\tmod',
      'projectBuild\tg:mod-a:1\tmod/a.xml',
      'project\tg:mod-b:1\tg\tmod-b\t1\tmod',
      'projectBuild\tg:mod-b:1\tmod/b.xml',
      'project\tg:bare:1\tg\tbare\t1\tbare',
    ].join('\n')
    const parsed = parseRecords(records)
    const { facts } = assembleFacts(parsed)

    expect(parsed.buildRoot).toBe('/repo/sub')
    expect(
      Object.fromEntries(
        facts.projects!.map(p => [p.id, p.manifestFiles ?? 'absent']),
      ),
    ).toEqual({
      'g:agg:1': [{ file: 'other-pom.xml' }],
      'g:bare:1': 'absent',
      'g:mod-a:1': [{ file: 'mod/a.xml' }],
      'g:mod-b:1': [{ file: 'mod/b.xml' }],
    })
  })
  it('attributes a Gradle project without a build file of its own to the scripts declaring its dependencies', () => {
    const records = [
      'meta\tgradle\t9.2.1\t21',
      'buildRoot\t/repo',
      'project\t:\tg\troot\t1\t.',
      'projectBuild\t:\tbuild.gradle.kts',
      'project\t:a\tg\ta\t1\ta',
      'declared\t:a\tx\tfrom-root\tbuild.gradle.kts',
      'project\t:b\tg\tb\t1\tb',
      'projectBuild\t:b\tb/build.gradle.kts',
      'declared\t:b\tx\tfrom-root\tbuild.gradle.kts',
      'declared\t:b\tx\town\tb/build.gradle.kts',
      'root\tr1\t:a\truntimeClasspath\t1',
      'node\tr1\tx:from-root:jar:1\tx\tfrom-root\t1\tjar\t\t1',
      'root\tr2\t:b\truntimeClasspath\t1',
      'node\tr2\tx:from-root:jar:1\tx\tfrom-root\t1\tjar\t\t1',
      'node\tr2\tx:own:jar:1\tx\town\t1\tjar\t\t1',
      'node\tr2\tx:by-plugin:jar:1\tx\tby-plugin\t1\tjar\t\t1',
    ].join('\n')
    const { facts } = assembleFacts(parseRecords(records))

    expect(
      Object.fromEntries(
        facts.projects!.map(p => [p.id, p.manifestFiles?.map(m => m.file)]),
      ),
    ).toEqual({
      ':': ['build.gradle.kts'],
      ':a': ['build.gradle.kts'],
      ':b': ['b/build.gradle.kts'],
    })
  })
  it('falls back to the configured Gradle build file even when absent', () => {
    const records = [
      'meta\tgradle\t9.2.1\t21',
      'buildRoot\t/repo',
      'project\t:a\tg\ta\t1\ta',
      'projectBuild\t:a\ta/build.gradle.kts\tmissing',
      'root\tr1\t:a\truntimeClasspath\t1',
      'node\tr1\tx:undeclared:jar:1\tx\tundeclared\t1\tjar\t\t1',
    ].join('\n')
    const { facts } = assembleFacts(parseRecords(records))

    expect(facts.projects![0]?.manifestFiles).toEqual([
      { file: 'a/build.gradle.kts' },
    ])
  })
})

describe('parseRecords', () => {
  it('reads the build root the build reports', () => {
    expect(
      parseRecords(
        ['meta\tmaven\t3.9.6\t17', 'buildRoot\t/repo/sub'].join('\n'),
      ).buildRoot,
    ).toBe('/repo/sub')
  })
})
