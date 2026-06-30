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
    accumulateSidecar(acc, facts, artifactPaths)
    const byName = new Map(serializeSidecar(acc).map(r => [r.name, r]))

    // First-party module: project-only (not a node), yet its source/output
    // roots reach the sidecar.
    expect(byName.get('app')).toEqual({
      group: 'com.example',
      name: 'app',
      version: '1.0',
      ext: '',
      classifier: null,
      targets: ['/abs/app/build/classes'],
      sources: ['/abs/app/src/main/java'],
    })

    // External dependency: jar target, no sources.
    expect(byName.get('lib')?.targets).toEqual(['/abs/lib.jar'])
    expect(byName.get('lib')?.sources).toEqual([])

    // Artifactless BOM: present with empty arrays (resolved, no artifact).
    expect(byName.get('bom')).toMatchObject({ targets: [], sources: [] })
  })
})
