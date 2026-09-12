/**
 * Shared jsonproto fixtures for the metadata-cquery test files.
 */

// Sample envelope shape Bazel 5+ emits: `{ "results": [ { "target": {...} } ] }`.
// Two rules: one with `tags`/`maven_coordinates` (rules_jvm_external shape)
// and one with the direct `maven_coordinates` attr only (Bazel-native shape).
export const ENVELOPE_FIXTURE = JSON.stringify({
  results: [
    {
      target: {
        type: 'RULE',
        rule: {
          name: '@maven//:androidx_annotation_annotation',
          ruleClass: 'jvm_import',
          attribute: [
            {
              name: 'maven_coordinates',
              type: 'STRING',
              stringValue: 'androidx.annotation:annotation:1.8.2',
            },
            {
              name: 'tags',
              type: 'STRING_LIST',
              stringListValue: [
                'maven_coordinates=androidx.annotation:annotation:1.8.2',
                'maven_repository=https://maven.google.com',
              ],
            },
          ],
        },
      },
    },
    {
      target: {
        type: 'RULE',
        rule: {
          name: '@maven//:plain_lib',
          ruleClass: 'java_library',
          attribute: [
            {
              name: 'tags',
              type: 'STRING_LIST',
              stringListValue: ['maven_coordinates=com.example:plain:1.0'],
            },
          ],
        },
      },
    },
  ],
})

// Build a rule envelope with the given attributes. Keeps the edge-resolution
// fixtures compact.
export function ruleEnvelope(
  rules: Array<{
    name: string
    ruleClass?: string | undefined
    coord?: string | undefined
    deps?: string[] | undefined
    exports?: string[] | undefined
    runtimeDeps?: string[] | undefined
  }>,
): string {
  return JSON.stringify({
    results: rules.map(r => {
      const attribute: unknown[] = []
      if (r.coord) {
        attribute.push({
          name: 'maven_coordinates',
          type: 'STRING',
          stringValue: r.coord,
        })
      }
      if (r.deps) {
        attribute.push({
          name: 'deps',
          type: 'LABEL_LIST',
          stringListValue: r.deps,
        })
      }
      if (r.exports) {
        attribute.push({
          name: 'exports',
          type: 'LABEL_LIST',
          stringListValue: r.exports,
        })
      }
      if (r.runtimeDeps) {
        attribute.push({
          name: 'runtime_deps',
          type: 'LABEL_LIST',
          stringListValue: r.runtimeDeps,
        })
      }
      return {
        target: {
          type: 'RULE',
          rule: {
            name: r.name,
            ruleClass: r.ruleClass ?? 'jvm_import',
            attribute,
          },
        },
      }
    }),
  })
}
