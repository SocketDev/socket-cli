/**
 * Unit tests for the shared JVM manifest reachability assertion.
 *
 * Every JVM build-tool smoke test runs
 * `src/commands/manifest/scripts/test/assert-reachability.py` over the records
 * its script emitted, asserting that each component is reachable from a direct
 * dependency of its own resolution root (the manifest consumer's "orphaned
 * component" check, REA-799). The fixtures need Gradle/Maven/sbt and a JDK, so
 * these run the assertion over synthetic records instead.
 *
 * Implementation: src/commands/manifest/scripts/test/assert-reachability.py
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ASSERT_PATH = path.join(
  __dirname,
  '../src/commands/manifest/scripts/test/assert-reachability.py',
)

const PROD_ROOT = '0'
const DEV_ROOT = '1'

/** A `root` row: the assertion only reads the id (field 2). */
function rootRow(rootId: string): string {
  return ['root', rootId, '', '', '0'].join('\t')
}

/** A `node` row: root id in field 2, coordinate in field 3, directness in field 9. */
function nodeRow(
  rootId: string,
  coordId: string,
  options: { direct: boolean },
): string {
  return [
    'node',
    rootId,
    coordId,
    '',
    '',
    '',
    '',
    '',
    options.direct ? '1' : '0',
  ].join('\t')
}

/** An `edge` row: root id in field 2, parent in field 3, child in field 4. */
function edgeRow(rootId: string, parent: string, child: string): string {
  return ['edge', rootId, parent, child].join('\t')
}

describe('assert-reachability.py', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'manifest-reachability-'))
  })

  afterEach(() => {
    rmSync(workDir, { force: true, recursive: true })
  })

  function run(rows: string[]): { status: number | null; output: string } {
    const recordsPath = path.join(workDir, 'records.tsv')
    writeFileSync(recordsPath, `${rows.join('\n')}\n`)

    const result = spawnSync('python3', [ASSERT_PATH, recordsPath], {
      cwd: workDir,
      encoding: 'utf8',
    })
    return { output: `${result.stdout}${result.stderr}`, status: result.status }
  }

  it('accepts direct nodes and their transitive closure', () => {
    // Gradle/SBT shape: bar is direct in the dev root; baz is transitive under it.
    const { output, status } = run([
      ['meta', 'gradle'].join('\t'),
      rootRow(PROD_ROOT),
      rootRow(DEV_ROOT),
      nodeRow(PROD_ROOT, 'demo.lib:foo:jar:1.0', { direct: true }),
      nodeRow(DEV_ROOT, 'demo.test:bar:jar:1.0', { direct: true }),
      edgeRow(DEV_ROOT, 'demo.test:bar:jar:1.0', 'demo.test:baz:jar:1.0'),
      nodeRow(DEV_ROOT, 'demo.test:baz:jar:1.0', { direct: false }),
    ])

    expect(output).toContain('PASS')
    expect(status).toBe(0)
  })

  it('rejects a non-direct node with no incoming edge', () => {
    const { output, status } = run([
      ['meta', 'sbt'].join('\t'),
      rootRow(PROD_ROOT),
      nodeRow(PROD_ROOT, 'demo:lib:1.0', { direct: true }),
      nodeRow(PROD_ROOT, 'demo:orphan:1.0', { direct: false }),
    ])

    expect(output).toContain(
      `root ${PROD_ROOT}: unreachable from any direct dependency: ['demo:orphan:1.0']`,
    )
    expect(status).not.toBe(0)
  })

  it('rejects a node whose only parent edge lives in another root', () => {
    // The Maven REA-799 shape: `shared` sits in the prod root, but its only
    // retained parent (`conflict-test`) is in the dev root.
    const { output, status } = run([
      ['meta', 'maven'].join('\t'),
      rootRow(PROD_ROOT),
      rootRow(DEV_ROOT),
      nodeRow(DEV_ROOT, 'demo.ext:conflict-test:jar:1.0', { direct: true }),
      nodeRow(PROD_ROOT, 'demo.ext:shared:jar:1.0', { direct: false }),
      edgeRow(
        DEV_ROOT,
        'demo.ext:conflict-test:jar:1.0',
        'demo.ext:shared:jar:1.0',
      ),
    ])

    expect(output).toContain(
      `root ${PROD_ROOT}: unreachable from any direct dependency: ['demo.ext:shared:jar:1.0']`,
    )
    expect(status).not.toBe(0)
  })

  it('accepts an empty records file', () => {
    const { output, status } = run([['meta', 'gradle'].join('\t')])

    expect(output).toContain('PASS')
    expect(status).toBe(0)
  })
})
