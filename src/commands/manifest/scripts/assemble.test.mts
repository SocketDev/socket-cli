import { describe, expect, it } from 'vitest'

import { assembleFacts } from './assemble.mts'
import { parseRecords } from './records.mts'
import { accumulateSidecar, serializeSidecar } from './sidecar.mts'

import type { SidecarAccumulator } from './sidecar.mts'

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
  it('merges a coordinate with divergent subtrees into one component and scopes classpaths per project', () => {
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
    expect(
      facts.components.find(c => c.id === 'g:lib:jar:1')?.dependencies,
    ).toEqual(['g:dep:jar:1', 'g:dep:jar:2'])

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(acc, facts, artifactPaths, '/abs/.socket.facts.json')
    const byName = new Map(
      serializeSidecar(acc)['/abs/.socket.facts.json']!.projects.map(p => [
        p.name,
        p.classpath,
      ]),
    )
    expect(byName.get('a')).toEqual(['g:dep:jar:1', 'g:lib:jar:1'])
    expect(byName.get('b')).toEqual([
      'g:dep:jar:2',
      'g:junit:jar:4',
      'g:lib:jar:1',
    ])
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

    expect(
      facts.components.map(c => [
        c.id,
        c.firstParty ?? 'absent',
        c.dependencies,
      ]),
    ).toEqual([
      [':a', true, ['g:ext:jar:2']],
      ['g:b:jar:0.9', 'absent', undefined],
      ['g:ext:jar:2', 'absent', undefined],
    ])
    expect(facts.projects!.find(p => p.id === ':b')?.dependencies).toEqual([
      ':a',
      'g:b:jar:0.9',
    ])

    const acc: SidecarAccumulator = new Map()
    accumulateSidecar(acc, facts, artifactPaths, '/abs/.socket.facts.json')
    const bucket = serializeSidecar(acc)['/abs/.socket.facts.json']!
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

    expect(
      facts.components.map(c => [c.id, c.qualifiers, c.dependencies]),
    ).toEqual([
      [':a:util', undefined, undefined],
      [':b:util', undefined, ['g:ext:jar:2']],
      ['g:ext:jar:2', { ext: 'jar' }, undefined],
    ])
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

  it('marks direct dependencies with the facts file and the build files of the subprojects they are direct in', () => {
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
        facts.components.map(c => [c.id, c.manifestFiles ?? 'absent']),
      ),
    ).toEqual({
      'g:a:jar:1': [{ file: '.socket.facts.json' }, { file: 'b/pom.xml' }],
      'g:dep:jar:3': 'absent',
      'g:ext:jar:2': [
        { file: '.socket.facts.json' },
        { file: 'a/pom.xml' },
        { file: 'b/pom.xml' },
      ],
      'g:solo:jar:1': [{ file: '.socket.facts.json' }],
    })
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
  it('attributes Gradle direct dependencies to the script declaring them', () => {
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
        facts.components.map(c => [
          c.id,
          c.manifestFiles?.map(m => m.file).slice(1),
        ]),
      ),
    ).toEqual({
      'x:by-plugin:jar:1': ['b/build.gradle.kts'],
      'x:from-root:jar:1': ['build.gradle.kts'],
      'x:own:jar:1': ['b/build.gradle.kts'],
    })
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

    expect(facts.components[0]?.manifestFiles).toEqual([
      { file: '.socket.facts.json' },
      { file: 'a/build.gradle.kts' },
    ])
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
