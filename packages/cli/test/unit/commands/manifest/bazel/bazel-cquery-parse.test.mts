/**
 * Unit tests for the metadata-cquery jsonproto parser: envelope + streamed
 * shapes, coordinate extraction, and dependency-edge resolution.
 */

import { describe, expect, it } from 'vitest'

import {
  parseCqueryJsonproto,
  versionlessCoordinate,
} from '../../../../../src/commands/manifest/bazel/bazel-cquery-parse.mts'
import { ENVELOPE_FIXTURE, ruleEnvelope } from './cquery-test-fixtures.mts'

describe('versionlessCoordinate', () => {
  it('strips only the trailing version, preserving packaging/classifier', () => {
    expect(versionlessCoordinate('g:a:1.0')).toBe('g:a')
    expect(versionlessCoordinate('g:a:aar:1.0')).toBe('g:a:aar')
    expect(versionlessCoordinate('g:a:jar:linux-x86_64:1.0')).toBe(
      'g:a:jar:linux-x86_64',
    )
  })

  it('returns coordinates with no version segment unchanged', () => {
    expect(versionlessCoordinate('g:a')).toBe('g:a')
  })
})

describe('parseCqueryJsonproto', () => {
  it('parses Bazel-5+ envelope shape and returns one artifact per rule', () => {
    const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
      ENVELOPE_FIXTURE,
      'maven',
      '',
    )
    expect(artifacts).toHaveLength(2)
    expect(unresolvedLabels).toEqual([])
    const first = artifacts[0]!
    expect(first.mavenCoordinates).toBe('androidx.annotation:annotation:1.8.2')
    expect(first.ruleKind).toBe('jvm_import')
    expect(first.ruleName).toBe('androidx_annotation_annotation')
    expect(first.sourceRepo).toBe('maven')
    expect(first.deps).toEqual([])

    const second = artifacts[1]!
    expect(second.mavenCoordinates).toBe('com.example:plain:1.0')
    expect(second.ruleKind).toBe('java_library')
    expect(second.ruleName).toBe('plain_lib')
  })

  it('emits workspace:<rel>+repo:<name> provenance via sourceRepo when workspaceRelPath is set', () => {
    const { artifacts } = parseCqueryJsonproto(
      ENVELOPE_FIXTURE,
      'maven',
      'examples/dagger',
    )
    expect(artifacts[0]?.sourceRepo).toBe('examples/dagger:maven')
  })

  it('falls back to snake_case payload keys (string_value, string_list_value)', () => {
    const snakeCase = JSON.stringify({
      results: [
        {
          target: {
            type: 'RULE',
            rule: {
              name: '@maven//:snake_case_artifact',
              rule_class: 'kt_jvm_import',
              attribute: [
                {
                  name: 'tags',
                  type: 'STRING_LIST',
                  string_list_value: [
                    'maven_coordinates=com.example:snake:2.0',
                  ],
                },
              ],
            },
          },
        },
      ],
    })
    const { artifacts } = parseCqueryJsonproto(snakeCase, 'maven', '')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.mavenCoordinates).toBe('com.example:snake:2.0')
    expect(artifacts[0]?.ruleKind).toBe('kt_jvm_import')
  })

  it('falls back to per-line jsonproto stream when envelope is absent', () => {
    const streamed = [
      JSON.stringify({
        type: 'RULE',
        rule: {
          name: '@maven//:a',
          ruleClass: 'jvm_import',
          attribute: [
            {
              name: 'maven_coordinates',
              type: 'STRING',
              stringValue: 'g:a:1',
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'RULE',
        rule: {
          name: '@maven//:b',
          ruleClass: 'jvm_import',
          attribute: [
            {
              name: 'maven_coordinates',
              type: 'STRING',
              stringValue: 'g:b:2',
            },
          ],
        },
      }),
    ].join('\n')
    const { artifacts } = parseCqueryJsonproto(streamed, 'maven', '')
    expect(artifacts.map(a => a.mavenCoordinates)).toEqual(['g:a:1', 'g:b:2'])
  })

  it('skips rules with no recoverable maven coordinate', () => {
    const noCoord = JSON.stringify({
      results: [
        {
          target: {
            type: 'RULE',
            rule: {
              name: '@maven//:no_coord',
              ruleClass: 'java_library',
              attribute: [
                {
                  name: 'tags',
                  type: 'STRING_LIST',
                  stringListValue: ['some_other_tag=value'],
                },
              ],
            },
          },
        },
      ],
    })
    expect(parseCqueryJsonproto(noCoord, 'maven', '').artifacts).toEqual([])
  })

  it('prefers the direct maven_coordinates attr over the tag fallback', () => {
    const conflicting = JSON.stringify({
      results: [
        {
          target: {
            type: 'RULE',
            rule: {
              name: '@maven//:dual',
              ruleClass: 'jvm_import',
              attribute: [
                {
                  name: 'maven_coordinates',
                  type: 'STRING',
                  stringValue: 'g:direct:1',
                },
                {
                  name: 'tags',
                  type: 'STRING_LIST',
                  stringListValue: ['maven_coordinates=g:via_tag:2'],
                },
              ],
            },
          },
        },
      ],
    })
    const { artifacts } = parseCqueryJsonproto(conflicting, 'maven', '')
    expect(artifacts[0]?.mavenCoordinates).toBe('g:direct:1')
  })

  it('returns [] on empty stdout', () => {
    expect(parseCqueryJsonproto('', 'maven', '').artifacts).toEqual([])
    expect(parseCqueryJsonproto('   \n\n', 'maven', '').artifacts).toEqual([])
  })

  describe('dependency-edge resolution', () => {
    it('resolves a simple deps edge to a versionless coordinate', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:junit_junit',
          coord: 'junit:junit:4.13.2',
          deps: ['@maven//:org_hamcrest_hamcrest_core'],
        },
        {
          name: '@maven//:org_hamcrest_hamcrest_core',
          coord: 'org.hamcrest:hamcrest-core:1.3',
        },
      ])
      const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
        stdout,
        'maven',
        '',
      )
      expect(unresolvedLabels).toEqual([])
      const junit = artifacts.find(a => a.ruleName === 'junit_junit')!
      expect(junit.deps).toEqual(['org.hamcrest:hamcrest-core'])
    })

    it('resolves an exports-only edge', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:a',
          coord: 'g:a:1',
          exports: ['@maven//:b'],
        },
        { name: '@maven//:b', coord: 'g:b:1' },
      ])
      const { artifacts } = parseCqueryJsonproto(stdout, 'maven', '')
      expect(artifacts.find(a => a.ruleName === 'a')!.deps).toEqual(['g:b'])
    })

    it('drops a dep label to a non-maven target without counting it', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:a',
          coord: 'g:a:1',
          deps: ['@platforms//os:linux', ':src', '//pkg:thing'],
        },
      ])
      const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
        stdout,
        'maven',
        '',
      )
      // `//pkg:thing` is a Bazel package-relative target, not a coordinate.
      expect(artifacts[0]!.deps).toEqual([])
      expect(unresolvedLabels).toEqual([])
    })

    it('skips a selected non-coordinate rule (not emitted as an artifact)', () => {
      const stdout = ruleEnvelope([
        { name: '@maven//:no_coords_rule', ruleClass: 'java_library' },
      ])
      expect(parseCqueryJsonproto(stdout, 'maven', '').artifacts).toEqual([])
    })

    it('flips partial when a dep points at a hub-prefixed target not in the selected set (apparent form)', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:a',
          coord: 'g:a:1',
          deps: ['@maven//:missing'],
        },
      ])
      const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
        stdout,
        'maven',
        '',
      )
      expect(artifacts[0]!.deps).toEqual([])
      expect(unresolvedLabels).toEqual(['@maven//:missing'])
    })

    it('flips partial for an unresolved hub-prefixed dep in bzlmod-canonical form', () => {
      const canonical = '@@rules_jvm_external++maven+maven//'
      const stdout = ruleEnvelope([
        {
          name: `${canonical}:a`,
          coord: 'g:a:1',
          deps: [`${canonical}:missing`],
        },
      ])
      const { unresolvedLabels } = parseCqueryJsonproto(stdout, 'maven', '')
      expect(unresolvedLabels).toEqual([`${canonical}:missing`])
    })

    it('resolves by full label and flips partial only on ambiguous suffix-only matches', () => {
      // Two coordinate-bearing targets in different packages share the bare
      // name `:widget`. A dep label that full-matches one resolves; a dep
      // label that only suffix-matches (ambiguous) flips partial.
      const stdout = ruleEnvelope([
        {
          name: '@maven//pkg1:widget',
          coord: 'g:widget1:1',
        },
        {
          name: '@maven//pkg2:widget',
          coord: 'g:widget2:1',
        },
        {
          name: '@maven//:consumer',
          coord: 'g:consumer:1',
          // Full-match resolves to widget1; bare-suffix-only is ambiguous.
          deps: ['@maven//pkg1:widget', '@maven//other:widget'],
        },
      ])
      const { artifacts, unresolvedLabels } = parseCqueryJsonproto(
        stdout,
        'maven',
        '',
      )
      const consumer = artifacts.find(a => a.ruleName === 'consumer')!
      expect(consumer.deps).toEqual(['g:widget1'])
      expect(unresolvedLabels).toEqual(['@maven//other:widget'])
    })

    it('keeps the :aar segment on classifier/aar artifacts and matches inbound edges', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:consumer',
          coord: 'g:consumer:1',
          deps: ['@maven//:androidx_test_monitor'],
        },
        {
          name: '@maven//:androidx_test_monitor',
          coord: 'androidx.test:monitor:aar:1.7.2',
        },
      ])
      const { artifacts } = parseCqueryJsonproto(stdout, 'maven', '')
      const monitor = artifacts.find(
        a => a.ruleName === 'androidx_test_monitor',
      )!
      // Key keeps the :aar packaging segment.
      expect(versionlessCoordinate(monitor.mavenCoordinates)).toBe(
        'androidx.test:monitor:aar',
      )
      const consumer = artifacts.find(a => a.ruleName === 'consumer')!
      expect(consumer.deps).toEqual(['androidx.test:monitor:aar'])
    })

    it('unions deps, exports, and runtime_deps', () => {
      const stdout = ruleEnvelope([
        {
          name: '@maven//:a',
          coord: 'g:a:1',
          deps: ['@maven//:b'],
          exports: ['@maven//:c'],
          runtimeDeps: ['@maven//:d'],
        },
        { name: '@maven//:b', coord: 'g:b:1' },
        { name: '@maven//:c', coord: 'g:c:1' },
        { name: '@maven//:d', coord: 'g:d:1' },
      ])
      const { artifacts } = parseCqueryJsonproto(stdout, 'maven', '')
      expect(artifacts.find(a => a.ruleName === 'a')!.deps.toSorted()).toEqual([
        'g:b',
        'g:c',
        'g:d',
      ])
    })
  })
})
