import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  parseBazelBuildOutput,
  parseUnsortedDepsJson,
} from './bazel-build-parser.mts'

// Resolve fixtures relative to this test file. `.mts` ESM has no __dirname.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'manifest-bazel',
  'query-output',
)

describe('parseBazelBuildOutput', () => {
  it('extracts jvm_import rules with maven_coordinates', () => {
    const text = readFileSync(
      path.join(FIXTURES, 'jvm-import-sample.txt'),
      'utf8',
    )
    const result = parseBazelBuildOutput(text)
    expect(result.length).toBe(2)
    expect(result[0]).toMatchObject({
      ruleKind: 'jvm_import',
      ruleName: 'com_google_guava_guava',
      mavenCoordinates: 'com.google.guava:guava:33.0.0-jre',
    })
    expect(result[0]?.mavenSha256).toMatch(/^9408c2c4/)
    expect(result[0]?.mavenUrl).toContain('repo1.maven.org')
    expect(result[0]?.deps).toEqual([
      '@maven//:com_google_guava_failureaccess',
      '@maven//:org_checkerframework_checker_qual',
    ])
  })

  it('skips rules without maven_coordinates', () => {
    const text = readFileSync(
      path.join(FIXTURES, 'jvm-import-sample.txt'),
      'utf8',
    )
    const result = parseBazelBuildOutput(text)
    expect(result.find(r => r.ruleName === 'no_coords_rule')).toBeUndefined()
  })

  it('extracts aar_import rules', () => {
    const text = readFileSync(
      path.join(FIXTURES, 'aar-import-sample.txt'),
      'utf8',
    )
    const result = parseBazelBuildOutput(text)
    expect(result.length).toBe(1)
    expect(result[0]?.ruleKind).toBe('aar_import')
    expect(result[0]?.mavenCoordinates).toBe(
      'androidx.annotation:annotation:1.7.0',
    )
  })

  it('returns empty array on empty input', () => {
    expect(parseBazelBuildOutput('')).toEqual([])
  })

  it('does not throw on truncated rule body', () => {
    const truncated =
      'jvm_import(\n  name = "x",\n  maven_coordinates = "g:a:v",\n'
    expect(() => parseBazelBuildOutput(truncated)).not.toThrow()
  })
})

describe('parseUnsortedDepsJson', () => {
  it('extracts artifacts in ExtractedArtifact shape', () => {
    const json = readFileSync(
      path.join(FIXTURES, 'unsorted-deps-sample.json'),
      'utf8',
    )
    const result = parseUnsortedDepsJson(json)
    expect(result.length).toBe(2)
    expect(result[0]?.mavenCoordinates).toBe(
      'com.google.guava:guava:33.0.0-jre',
    )
    expect(result[0]?.deps).toEqual([
      'com.google.guava:failureaccess:1.0.2',
      'org.checkerframework:checker-qual:3.41.0',
    ])
  })

  it('extracts v2 lock-file map artifacts', () => {
    const result = parseUnsortedDepsJson(
      JSON.stringify({
        artifacts: {
          'com.google.guava:guava': {
            shasums: { jar: 'abc123' },
            version: '33.0.0-jre',
          },
          'com.google.guava:failureaccess': {
            shasums: {},
            version: '1.0.2',
          },
        },
        dependencies: {
          'com.google.guava:guava': ['com.google.guava:failureaccess'],
        },
      }),
    )

    expect(result).toEqual([
      {
        ruleKind: 'jvm_import',
        ruleName: 'com_google_guava_guava',
        mavenCoordinates: 'com.google.guava:guava:33.0.0-jre',
        mavenSha256: 'abc123',
        deps: ['com.google.guava:failureaccess'],
      },
      {
        ruleKind: 'jvm_import',
        ruleName: 'com_google_guava_failureaccess',
        mavenCoordinates: 'com.google.guava:failureaccess:1.0.2',
        mavenSha256: undefined,
        deps: [],
      },
    ])
  })

  it('expands v2 lock-file classifier shasums into classifier artifacts', () => {
    const result = parseUnsortedDepsJson(
      JSON.stringify({
        artifacts: {
          'io.netty:netty-transport-native-epoll': {
            shasums: {
              'linux-aarch_64': 'linux-aarch-sha',
              'linux-x86_64': 'linux-x86-sha',
            },
            version: '4.1.115.Final',
          },
        },
        dependencies: {
          'io.netty:netty-transport-native-epoll:jar:linux-x86_64': [
            'io.netty:netty-buffer',
          ],
        },
      }),
    )

    expect(result).toEqual([
      {
        ruleKind: 'jvm_import',
        ruleName: 'io_netty_netty_transport_native_epoll_jar_linux_aarch_64',
        mavenCoordinates:
          'io.netty:netty-transport-native-epoll:jar:linux-aarch_64:4.1.115.Final',
        mavenSha256: 'linux-aarch-sha',
        deps: [],
      },
      {
        ruleKind: 'jvm_import',
        ruleName: 'io_netty_netty_transport_native_epoll_jar_linux_x86_64',
        mavenCoordinates:
          'io.netty:netty-transport-native-epoll:jar:linux-x86_64:4.1.115.Final',
        mavenSha256: 'linux-x86-sha',
        deps: ['io.netty:netty-buffer'],
      },
    ])
  })

  it('returns empty array on invalid JSON', () => {
    expect(parseUnsortedDepsJson('not json')).toEqual([])
  })

  it('returns empty array when artifacts field missing', () => {
    expect(parseUnsortedDepsJson('{}')).toEqual([])
  })
})
