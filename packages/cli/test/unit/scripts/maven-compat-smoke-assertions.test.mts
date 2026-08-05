/**
 * Unit tests for the maven-compat fixture's record assertions.
 *
 * Purpose: the fixture proves the Maven extension emits internal reactor
 * modules under their bare groupId:artifactId:version id, distinct from the
 * typed groupId:artifactId:type:version form used for external artifacts. The
 * lookup that checks this has to reject the typed form, or a regression that
 * stopped emitting the bare id would still pass. The fixture itself needs Maven
 * and a JDK, so these run its assertions over synthetic records instead.
 *
 * Related Files: -
 * src/commands/manifest/scripts/test/maven-compat/assert-records.py
 * (implementation) -
 * src/commands/manifest/scripts/test/maven-compat/smoke-test.sh (caller)
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ASSERT_RECORDS_PATH = path.join(
  __dirname,
  '../../../src/commands/manifest/scripts/test/maven-compat/assert-records.py',
)

const PROD_ROOT = 'app'
const TEST_ROOT = 'testroot'

/**
 * A `root` row: the assertions read the id from field 2 and prod-ness from
 * field 5.
 */
function rootRow(rootId: string, options: { prod: boolean }): string {
  return ['root', rootId, '', '', options.prod ? '1' : '0'].join('\t')
}

/**
 * A `node` row: root id in field 2, coordinate in field 3, directness in field
 * 9.
 */
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

/**
 * A `file` row: coordinate in field 3, materialized path in field 4.
 */
function fileRow(rootId: string, coordId: string, filePath: string): string {
  return ['file', rootId, coordId, filePath].join('\t')
}

/**
 * A records file the assertions accept, apart from the internal module's
 * coordinate, which each test supplies.
 */
function buildRecords(internalModuleCoord: string): string {
  return [
    ['meta', 'maven'].join('\t'),
    rootRow(PROD_ROOT, { prod: true }),
    rootRow(TEST_ROOT, { prod: false }),
    // External prod dependency, materialized as a jar.
    nodeRow(PROD_ROOT, 'demo.ext:tool:jar:1.0', { direct: true }),
    fileRow(PROD_ROOT, 'demo.ext:tool:jar:1.0', '/repo/tool-1.0.jar'),
    // Test-scope dependency and its transitive, kept out of the prod root.
    nodeRow(TEST_ROOT, 'demo.ext:harness:jar:1.0', { direct: true }),
    fileRow(TEST_ROOT, 'demo.ext:harness:jar:1.0', '/repo/harness-1.0.jar'),
    nodeRow(TEST_ROOT, 'demo.ext:harness-core:jar:1.0', { direct: false }),
    // The internal reactor module under test.
    nodeRow(PROD_ROOT, internalModuleCoord, { direct: true }),
    '',
  ].join('\n')
}

describe('maven-compat assert-records.py', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'maven-compat-assert-'))
  })

  afterEach(async () => {
    await safeDelete(workDir)
  })

  /**
   * Run the fixture's assertions over a records file naming
   * `internalModuleCoord`.
   */
  async function assertRecords(internalModuleCoord: string): Promise<{
    code: number
    output: string
  }> {
    const recordsPath = path.join(workDir, 'records.tsv')
    writeFileSync(recordsPath, buildRecords(internalModuleCoord))

    try {
      const result = await spawn(
        'python3',
        [ASSERT_RECORDS_PATH, recordsPath],
        {
          cwd: workDir,
        },
      )
      return { code: 0, output: result.stdout }
    } catch (e) {
      const err = e as {
        code?: number | undefined
        stderr?: string | undefined
        stdout?: string | undefined
      }
      return {
        code: err.code ?? 1,
        output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
      }
    }
  }

  it('accepts an internal module emitted under its bare id', async () => {
    const { code, output } = await assertRecords('demo:lib:1.0')

    expect(output).toContain('PASS')
    expect(code).toBe(0)
  })

  it('rejects an internal module emitted only under a typed id', async () => {
    // 'demo:lib:' is a prefix of 'demo:lib:jar:1.0', so a lookup that matched
    // on the prefix alone would report bare-id coverage it does not have.
    const { code, output } = await assertRecords('demo:lib:jar:1.0')

    expect(output).toContain(
      'internal module demo:lib not emitted by its bare id',
    )
    expect(code).not.toBe(0)
  })

  it('rejects an internal module that is missing entirely', async () => {
    const { code, output } = await assertRecords('demo:unrelated:1.0')

    expect(output).toContain(
      'internal module demo:lib not emitted by its bare id',
    )
    expect(code).not.toBe(0)
  })
})
