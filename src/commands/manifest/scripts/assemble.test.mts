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
})
