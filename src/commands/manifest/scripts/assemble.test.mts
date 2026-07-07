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

// Records as emitted by the socket-facts-dotnet tool: groupless nuget
// coordinates, one prod + one dev root per (project, target framework).
const DOTNET_RECORDS = [
  'meta\tdotnet\t8.0.414\t',
  'project\t/abs/MyApp/MyApp.csproj\t\tMyApp\t1.0.0\tMyApp',
  'projectSrc\t/abs/MyApp/MyApp.csproj\t/abs/MyApp',
  'root\t/abs/MyApp/MyApp.csproj|net8.0|prod\t/abs/MyApp/MyApp.csproj\tnet8.0\t1',
  'node\t/abs/MyApp/MyApp.csproj|net8.0|prod\tNewtonsoft.Json:13.0.3\t\tNewtonsoft.Json\t13.0.3\t\t\t1',
  'file\t/abs/MyApp/MyApp.csproj|net8.0|prod\tNewtonsoft.Json:13.0.3\t/abs/nuget/newtonsoft.json/13.0.3/lib/net6.0/Newtonsoft.Json.dll',
  'root\t/abs/MyApp/MyApp.csproj|net8.0|dev\t/abs/MyApp/MyApp.csproj\tnet8.0\t0',
  'node\t/abs/MyApp/MyApp.csproj|net8.0|dev\tNuGet.Versioning:6.12.1\t\tNuGet.Versioning\t6.12.1\t\t\t1',
  'scanned\tnet8.0',
].join('\n')

describe('dotnet records → assemble', () => {
  it('emits groupless nuget components with prod/dev split flags', () => {
    const { artifactPaths, facts } = assembleFacts(
      parseRecords(DOTNET_RECORDS),
      {
        fileExists: () => true,
      },
    )

    expect(facts.metadata).toEqual({
      format: 'socket-facts-sbom',
      tool: 'dotnet',
      toolVersion: '8.0.414',
    })

    const newtonsoft = facts.components.find(c => c.name === 'Newtonsoft.Json')
    expect(newtonsoft).toMatchObject({
      type: 'nuget',
      id: 'Newtonsoft.Json:13.0.3',
      version: '13.0.3',
      direct: true,
    })
    // Groupless: no namespace key at all, and no empty qualifiers.
    expect(newtonsoft).not.toHaveProperty('namespace')
    expect(newtonsoft).not.toHaveProperty('qualifiers')
    expect(newtonsoft?.dev).toBeUndefined()

    const versioning = facts.components.find(c => c.name === 'NuGet.Versioning')
    expect(versioning).toMatchObject({ type: 'nuget', dev: true, direct: true })

    const project = facts.projects?.find(p => p.name === 'MyApp')
    expect(project).toMatchObject({
      type: 'nuget',
      subprojectDir: 'MyApp',
      dependencies: [
        'NuGet.Versioning:6.12.1',
        'Newtonsoft.Json:13.0.3',
      ].sort(),
    })

    expect(artifactPaths.targetsByCoord.get('Newtonsoft.Json:13.0.3')).toEqual([
      '/abs/nuget/newtonsoft.json/13.0.3/lib/net6.0/Newtonsoft.Json.dll',
    ])
    expect(artifactPaths.sourcesByCoord.get('MyApp:1.0.0')).toEqual([
      '/abs/MyApp',
    ])
  })
})
