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
  it("carries an excluded module's paths into the kept project that depends on it", () => {
    const records = [
      'meta\tgradle\t8.10\t17',
      'project\t:app\tg\tapp\t1\tapp',
      'projectSrc\t:app\t/abs/app/src',
      'projectTgt\t:app\t/abs/app/classes',
      'excludedProject\t:lib',
      'projectSrc\t:lib\t/abs/lib/src',
      'projectTgt\t:lib\t/abs/lib/classes',
      'root\t0\t:app\tcompileClasspath\t1',
      'node\t0\t:lib\tg\tlib\t1\tjar\t\t1\t:lib',
    ].join('\n')
    const { artifactPaths, facts } = assembleFacts(parseRecords(records), {
      fileExists: () => true,
    })

    expect(facts.projects?.map(p => p.id)).toEqual([':app'])
    expect(artifactPaths.pathsById.get(':lib')).toEqual({
      sources: ['/abs/lib/src'],
      targets: ['/abs/lib/classes'],
    })
    expect([...artifactPaths.classpathByProject.keys()]).toEqual([':app'])
  })
  it('states no targets for an artifact that failed to resolve or is gone from disk', () => {
    const records = [
      'meta\tmaven\t3.9.6\t17',
      'project\tg:app:1\tg\tapp\t1\t.',
      'root\t0\tg:app:1\tcompile\t1',
      'node\t0\tg:ok:jar:1\tg\tok\t1\tjar\t\t1',
      'node\t0\tg:nojar:jar:1\tg\tnojar\t1\tjar\t\t1',
      'node\t0\tg:nojar:test-jar:tests:1\tg\tnojar\t1\ttest-jar\ttests\t1',
      'node\t0\tg:gone:jar:1\tg\tgone\t1\tjar\t\t1',
      'node\t0\tg:bom:pom:1\tg\tbom\t1\tpom\t\t1',
      'node\t0\tg:half:jar:1\tg\thalf\t1\tjar\t\t1',
      'node\t0\tg:halfgone:jar:1\tg\thalfgone\t1\tjar\t\t1',
      'file\t0\tg:ok:jar:1\t/abs/ok.jar',
      'file\t0\tg:half:jar:1\t/abs/half-a.jar',
      'unfetched\t0\tg:half:jar:1',
      'file\t0\tg:halfgone:jar:1\t/abs/halfgone-a.jar',
      'file\t0\tg:halfgone:jar:1\t/abs/gone.jar',
      'file\t0\tg:gone:jar:1\t/abs/gone.jar',
      'file\t0\tg:nojar:test-jar:tests:1\t/abs/nojar-tests.jar',
      'unfetched\t0\tg:nojar:jar:1',
    ].join('\n')
    const { artifactPaths, facts } = assembleFacts(parseRecords(records), {
      fileExists: p => p !== '/abs/gone.jar',
    })
    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      facts,
      artifactPaths,
      '/abs/pom.xml.socket.facts.json',
    )
    const byId = new Map(
      serializeSidecar(acc)['/abs/pom.xml.socket.facts.json']!.components.map(
        c => [c.id, c],
      ),
    )

    expect(byId.get('g:ok:jar:1')?.targets).toEqual(['/abs/ok.jar'])
    expect(byId.get('g:nojar:jar:1')).not.toHaveProperty('targets')
    expect(byId.get('g:nojar:test-jar:tests:1')?.targets).toEqual([
      '/abs/nojar-tests.jar',
    ])
    expect(byId.get('g:gone:jar:1')).not.toHaveProperty('targets')
    expect(byId.get('g:bom:pom:1')?.targets).toEqual([])
    // One of several files missing leaves the artifact incomplete.
    expect(byId.get('g:half:jar:1')).not.toHaveProperty('targets')
    expect(byId.get('g:halfgone:jar:1')).not.toHaveProperty('targets')
  })
  it('keeps the targets of an artifact that another root fetched', () => {
    const records = [
      'meta\tmaven\t3.9.6\t17',
      'project\tg:a:1\tg\ta\t1\ta',
      'project\tg:b:1\tg\tb\t1\tb',
      'root\t0\tg:a:1\tcompile\t1',
      'root\t1\tg:b:1\tcompile\t1',
      'node\t0\tg:lib:jar:1\tg\tlib\t1\tjar\t\t1',
      'node\t1\tg:lib:jar:1\tg\tlib\t1\tjar\t\t1',
      'node\t0\tg:moved:jar:1\tg\tmoved\t1\tjar\t\t1',
      'node\t1\tg:moved:jar:1\tg\tmoved\t1\tjar\t\t1',
      'unfetched\t0\tg:lib:jar:1',
      'file\t1\tg:lib:jar:1\t/abs/lib.jar',
      'file\t0\tg:moved:jar:1\t/abs/gone.jar',
      'file\t1\tg:moved:jar:1\t/abs/moved.jar',
    ].join('\n')
    const { artifactPaths } = assembleFacts(parseRecords(records), {
      fileExists: p => p !== '/abs/gone.jar',
    })

    expect(artifactPaths.pathsById.get('g:lib:jar:1')?.targets).toEqual([
      '/abs/lib.jar',
    ])
    expect(artifactPaths.pathsById.get('g:moved:jar:1')?.targets).toEqual([
      '/abs/moved.jar',
    ])
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
  it('marks each Gradle project with its configured build file, even when absent', () => {
    const records = [
      'meta\tgradle\t9.2.1\t21',
      'buildRoot\t/repo',
      'project\t:\tg\troot\t1\t.',
      'projectBuild\t:\tbuild.gradle.kts',
      // Configured from the root build, no script of its own.
      'project\t:a\tg\ta\t1\ta',
      'projectBuild\t:a\ta/build.gradle.kts',
      'root\tr1\t:a\truntimeClasspath\t1',
      'node\tr1\tx:from-root:jar:1\tx\tfrom-root\t1\tjar\t\t1',
    ].join('\n')
    const { facts } = assembleFacts(parseRecords(records))

    expect(
      Object.fromEntries(
        facts.projects!.map(p => [p.id, p.manifestFiles?.map(m => m.file)]),
      ),
    ).toEqual({
      ':': ['build.gradle.kts'],
      ':a': ['a/build.gradle.kts'],
    })
  })
})

describe('dotnet records → assemble', () => {
  const DOTNET = [
    'meta\tdotnet\t8.0.414\t',
    'buildRoot\t/abs',
    'entry\tApp.sln',
    'project\tsrc/App/App.csproj\t\tApp\t1.0.0\tsrc/App',
    'projectBuild\tsrc/App/App.csproj\tsrc/App/App.csproj',
    'projectBuild\tsrc/App/App.csproj\tDirectory.Packages.props',
    'project\tsrc/Lib/Lib.csproj\t\tAcme.Lib\t2.0.0\tsrc/Lib',
    'root\tsrc/App/App.csproj|net8.0|prod\tsrc/App/App.csproj\tnet8.0\t1',
    'node\tsrc/App/App.csproj|net8.0|prod\tacme.lib:2.0.0\t\tAcme.Lib\t2.0.0\t\t\t1\tsrc/Lib/Lib.csproj',
    'node\tsrc/App/App.csproj|net8.0|prod\tnewtonsoft.json:13.0.3\t\tNewtonsoft.Json\t13.0.3\t\t\t0\t',
    'edge\tsrc/App/App.csproj|net8.0|prod\tacme.lib:2.0.0\tnewtonsoft.json:13.0.3',
    'root\tsrc/Lib/Lib.csproj|net8.0|prod\tsrc/Lib/Lib.csproj\tnet8.0\t1',
    'node\tsrc/Lib/Lib.csproj|net8.0|prod\tnewtonsoft.json:13.0.3\t\tNewtonsoft.Json\t13.0.3\t\t\t1\t',
    'scanned\tnet8.0',
  ].join('\r\n')

  it('assembles nuget purls without a namespace, with project-path ids', () => {
    const { facts } = assembleFacts(parseRecords(DOTNET))
    expect(facts.metadata?.tool).toBe('dotnet')
    expect(facts.components).toEqual([
      {
        type: 'nuget',
        name: 'Newtonsoft.Json',
        version: '13.0.3',
        id: 'newtonsoft.json:13.0.3',
        direct: true,
      },
      {
        type: 'nuget',
        name: 'Acme.Lib',
        version: '2.0.0',
        id: 'src/Lib/Lib.csproj',
        direct: true,
        firstParty: true,
      },
    ])
    expect(facts.projects?.map(p => ({ ...p, children: undefined }))).toEqual([
      {
        id: 'src/App/App.csproj',
        type: 'nuget',
        name: 'App',
        version: '1.0.0',
        subprojectDir: 'src/App',
        manifestFiles: [
          { file: 'Directory.Packages.props' },
          { file: 'src/App/App.csproj' },
        ],
        children: undefined,
      },
      {
        id: 'src/Lib/Lib.csproj',
        type: 'nuget',
        name: 'Acme.Lib',
        version: '2.0.0',
        subprojectDir: 'src/Lib',
        children: undefined,
      },
    ])
    expect(trees(facts)).toEqual({
      'src/App/App.csproj': ['src/Lib/Lib.csproj(newtonsoft.json:13.0.3)'],
      'src/Lib/Lib.csproj': ['newtonsoft.json:13.0.3'],
    })
  })
})

describe('dotnet records → sidecar', () => {
  it('carries assemblies, compile items and unresolved packages per nuget purl', () => {
    const records = [
      'meta\tdotnet\t8.0.414\t',
      'project\tApp.csproj\t\tApp\t1.0.0\t.',
      'projectSrc\tApp.csproj\t/abs/Program.cs',
      'projectTgt\tApp.csproj\t/abs/bin/App.dll',
      'root\tr\tApp.csproj\tnet8.0\t1',
      'node\tr\tlib:1.0.0\t\tLib\t1.0.0\t\t\t1\t',
      'file\tr\tlib:1.0.0\t/pkgs/lib/1.0.0/lib/net8.0/Lib.dll',
      'node\tr\tanalyzer:1.0.0\t\tAnalyzer\t1.0.0\t\t\t1\t',
      'node\tr\tgone:1.0.0\t\tGone\t1.0.0\t\t\t1\t',
      'unfetched\tr\tgone:1.0.0',
    ].join('\n')
    const { artifactPaths, facts } = assembleFacts(parseRecords(records), {
      fileExists: () => true,
    })
    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      facts,
      artifactPaths,
      '/abs/App.csproj.socket.facts.json',
    )
    const entry = serializeSidecar(acc)['/abs/App.csproj.socket.facts.json']!
    expect(entry.components.map(c => [c.type, c.name, c.targets])).toEqual([
      ['nuget', 'Analyzer', []],
      ['nuget', 'Gone', undefined],
      ['nuget', 'Lib', ['/pkgs/lib/1.0.0/lib/net8.0/Lib.dll']],
    ])
    expect(entry.projects).toMatchObject([
      {
        id: 'App.csproj',
        type: 'nuget',
        sources: ['/abs/Program.cs'],
        targets: ['/abs/bin/App.dll'],
        dependencies: ['analyzer:1.0.0', 'gone:1.0.0', 'lib:1.0.0'],
      },
    ])
    expect(entry.projects[0]).not.toHaveProperty('namespace')
  })
})

describe('dotnet records → per-framework sidecar', () => {
  const records = [
    'meta\tdotnet\t8.0.414\t',
    'project\tLib.csproj\t\tLib\t1.0.0\t.',
    'projectSrc\tLib.csproj\t/abs/L.cs\tnet8.0',
    'projectSrc\tLib.csproj\t/abs/obj/Lib.AssemblyInfo.cs\tnet8.0',
    'projectSrc\tLib.csproj\t/abs/Legacy.cs\tnetstandard2.0',
    'projectInfo\tLib.csproj\tnetstandard2.0\tBuildError\tMSB3644: reference assemblies not found',
    'projectTgt\tLib.csproj\t/abs/bin/net8.0/Lib.dll\tnet8.0',
    'projectInfo\tLib.csproj\tnet8.0\tTargetFrameworkMoniker\t.NETCoreApp,Version=v8.0',
    'projectInfo\tLib.csproj\tnet8.0\tDefineConstant\tNET8_0_OR_GREATER',
    'projectInfo\tLib.csproj\tnet8.0\tFrameworkReference\tMicrosoft.NETCore.App',
    'projectInfo\tLib.csproj\tnet8.0\tNullable\tenable',
    'projectInfo\tLib.csproj\tnet8.0\tReference\t/packs/ref/net8.0/System.Runtime.dll',
    'projectInfo\tLib.csproj\tnet8.0\tReference\t/pkgs/x/ref/net8.0/X.dll',
    'projectInfo\tLib.csproj\tnet8.0\tAnalyzer\t/packs/analyzers/Gen.dll',
    'projectUsing\tLib.csproj\tnet8.0\tSystem.Linq\t\t0',
    'projectUsing\tLib.csproj\tnet8.0\tSystem.Math\t\t1',
    'root\ta\tLib.csproj\tnet8.0\t0\tnet8.0\t\tnet8.0',
    'node\ta\tx:1.0.0\t\tX\t1.0.0\t\t\t1\t',
    'file\ta\tx:1.0.0\t/pkgs/x/lib/net8.0/X.dll',
    'compileFile\ta\tx:1.0.0\t/pkgs/x/ref/net8.0/X.dll',
    'node\ta\tgone:1.0.0\t\tGone\t1.0.0\t\t\t1\t',
    'unfetched\ta\tgone:1.0.0',
    'root\tp\tLib.csproj\tnet8.0\t1\tnet8.0\t\tnet8.0',
    'node\tp\tx:1.0.0\t\tX\t1.0.0\t\t\t1\t',
    'node\tp\tgone:1.0.0\t\tGone\t1.0.0\t\t\t1\t',
    'root\ts\tLib.csproj\tnetstandard2.0\t0\tnetstandard2.0\t\tnetstandard2.0',
    'node\ts\tx:1.0.0\t\tX\t1.0.0\t\t\t1\t',
    'file\ts\tx:1.0.0\t/pkgs/x/lib/netstandard2.0/X.dll',
  ].join('\n')

  it('gives each project build its own context and each package its assemblies per framework', () => {
    const { artifactPaths, facts } = assembleFacts(parseRecords(records), {
      fileExists: () => true,
    })
    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(
      acc,
      facts,
      artifactPaths,
      '/abs/Lib.csproj.socket.facts.json',
    )
    const entry = serializeSidecar(acc)['/abs/Lib.csproj.socket.facts.json']!
    expect(entry.projects[0]!.frameworks).toEqual([
      {
        alias: 'net8.0',
        framework: 'net8.0',
        targetFrameworkMoniker: '.NETCoreApp,Version=v8.0',
        language: undefined,
        langVersion: undefined,
        nullable: 'enable',
        assemblyName: undefined,
        buildError: undefined,
        frameworkReferences: ['Microsoft.NETCore.App'],
        defineConstants: ['NET8_0_OR_GREATER'],
        usings: [
          { namespace: 'System.Linq' },
          { namespace: 'System.Math', static: true },
        ],
        // Compiler order, not sorted.
        sources: ['/abs/L.cs', '/abs/obj/Lib.AssemblyInfo.cs'],
        references: [
          '/packs/ref/net8.0/System.Runtime.dll',
          '/pkgs/x/ref/net8.0/X.dll',
        ],
        analyzers: ['/packs/analyzers/Gen.dll'],
        targets: ['/abs/bin/net8.0/Lib.dll'],
        dependencies: ['gone:1.0.0', 'x:1.0.0'],
        classpath: ['gone:1.0.0', 'x:1.0.0'],
      },
      expect.objectContaining({
        alias: 'netstandard2.0',
        buildError: 'MSB3644: reference assemblies not found',
        sources: ['/abs/Legacy.cs'],
        references: [],
        targets: [],
        classpath: ['x:1.0.0'],
      }),
    ])
    const byName = Object.fromEntries(
      entry.components.map(c => [c.name, c.frameworks]),
    )
    expect(byName['X']).toEqual([
      {
        framework: 'net8.0',
        targets: ['/pkgs/x/lib/net8.0/X.dll'],
        compile: ['/pkgs/x/ref/net8.0/X.dll'],
      },
      {
        framework: 'netstandard2.0',
        targets: ['/pkgs/x/lib/netstandard2.0/X.dll'],
        compile: [],
      },
    ])
    // A root without files (the prod one) does not count as resolving it.
    expect(byName['Gone']).toEqual([{ framework: 'net8.0' }])
  })
})

describe('dotnet build without dependencies', () => {
  it('still gets its compile context in the sidecar', () => {
    const records = [
      'meta\tdotnet\t8.0.414\t',
      'project\tLeaf.csproj\t\tLeaf\t1.0.0\t.',
      'projectSrc\tLeaf.csproj\t/abs/Leaf.cs\tnet8.0',
      'projectInfo\tLeaf.csproj\tnet8.0\tFramework\tnet8.0',
      'projectInfo\tLeaf.csproj\tnet8.0\tFrameworkReference\tMicrosoft.NETCore.App',
    ].join('\n')
    const { artifactPaths } = assembleFacts(parseRecords(records), {
      fileExists: () => true,
    })
    expect(artifactPaths.frameworksByProject?.get('Leaf.csproj')).toMatchObject(
      [
        {
          alias: 'net8.0',
          framework: 'net8.0',
          frameworkReferences: ['Microsoft.NETCore.App'],
          sources: ['/abs/Leaf.cs'],
          dependencies: [],
          classpath: [],
        },
      ],
    )
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
