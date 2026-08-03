/**
 * Unit tests for the Maven manifest normalization helpers: maven_install.json
 * synthesis, malformed-coordinate dropping, edge pruning, and cross-workspace
 * artifact dedup.
 */

import { describe, expect, it } from 'vitest'

import {
  dedupArtifactsByCoord,
  normalizeToMavenInstallJson,
} from '../../../../../src/commands/manifest/bazel/bazel-maven-manifest.mts'
import { mkArt } from './extract-maven-test-helpers.mts'

describe('normalizeToMavenInstallJson', () => {
  it('dedupes exact duplicate coordinates without failing', () => {
    const result = normalizeToMavenInstallJson([
      mkArt('com.google.guava:guava:33.0.0-jre', 'com_google_guava_guava'),
      mkArt('com.google.guava:guava:33.0.0-jre', 'com_google_guava_guava'),
    ])
    expect(Object.keys(result.json.artifacts)).toEqual([
      'com.google.guava:guava',
    ])
  })

  it('fails on conflicting versions for the same group:artifact', () => {
    expect(() =>
      normalizeToMavenInstallJson([
        mkArt('com.example:lib:1.0', 'a'),
        mkArt('com.example:lib:2.0', 'b'),
      ]),
    ).toThrow(/Conflicting versions/)
  })

  it('emits no shasums key on artifacts', () => {
    const result = normalizeToMavenInstallJson([
      mkArt('com.example:lib:1.0', 'a'),
    ])
    expect(result.json.artifacts['com.example:lib']).toEqual({
      version: '1.0',
    })
    expect(result.json.artifacts['com.example:lib']).not.toHaveProperty(
      'shasums',
    )
  })

  it('emits a closed graph: all edges between emitted artifacts survive', () => {
    const result = normalizeToMavenInstallJson([
      mkArt('com.google.guava:guava:33.0.0-jre', 'com_google_guava_guava', {
        deps: ['com.google.guava:failureaccess'],
      }),
      mkArt(
        'com.google.guava:failureaccess:1.0.2',
        'com_google_guava_failureaccess',
      ),
    ])
    expect(result.json.dependencies['com.google.guava:guava']).toEqual([
      'com.google.guava:failureaccess',
    ])
    expect(result.droppedArtifacts).toEqual([])
    expect(result.prunedEdges).toEqual([])
  })

  it('keeps the :aar packaging segment on the artifact key', () => {
    const result = normalizeToMavenInstallJson([
      mkArt('androidx.test:monitor:aar:1.7.2', 'androidx_test_monitor', {
        ruleKind: 'aar_import',
      }),
    ])
    expect(Object.keys(result.json.artifacts)).toEqual([
      'androidx.test:monitor:aar',
    ])
  })

  it('skips a malformed coordinate (empty version) and reports it as dropped', () => {
    // `g:a:` strips to the valid-shaped key `g:a` but an empty version.
    const result = normalizeToMavenInstallJson([mkArt('com.example:lib:', 'a')])
    expect(Object.keys(result.json.artifacts)).toEqual([])
    expect(result.droppedArtifacts).toEqual(['com.example:lib:'])
  })

  it('prunes a dangling edge whose target was never emitted and reports it', () => {
    const result = normalizeToMavenInstallJson([
      // Target `g:a:` is malformed and dropped, so the inbound edge dangles.
      mkArt('com.example:consumer:1.0', 'consumer', {
        deps: ['com.example:lib'],
      }),
      mkArt('com.example:lib:', 'lib'),
    ])
    expect(result.json.dependencies['com.example:consumer']).toBeUndefined()
    expect(result.prunedEdges).toEqual([
      'com.example:consumer -> com.example:lib',
    ])
    expect(result.droppedArtifacts).toEqual(['com.example:lib:'])
  })
})

describe('dedupArtifactsByCoord', () => {
  it('unions resolved edges across deduped occurrences of a coordinate', () => {
    // The dedup keeps one artifact per full coordinate but must union the
    // resolved edges of every occurrence; otherwise edges resolved against a
    // second workspace's targets would be silently dropped.
    const manifest = normalizeToMavenInstallJson(
      dedupArtifactsByCoord([
        mkArt('com.google.guava:guava:33.0.0-jre', 'guava', {
          deps: ['com.google.dagger:dagger'],
        }),
        mkArt('com.google.guava:guava:33.0.0-jre', 'guava', {
          deps: ['com.x:x'],
        }),
        mkArt('com.google.dagger:dagger:2.50', 'dagger'),
        mkArt('com.x:x:1.0', 'x'),
      ]),
    )
    expect(
      manifest.json.dependencies['com.google.guava:guava']?.toSorted(),
    ).toEqual(['com.google.dagger:dagger', 'com.x:x'])
    expect(manifest.prunedEdges).toEqual([])
  })
})
