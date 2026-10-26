import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureJavaOnPath } from './bazel-java-shim.mts'
import { findBazelExecutable, getBazelEnvironment } from './bazel-process.mts'

const java = await findBazelExecutable(
  'java',
  getBazelEnvironment(),
  process.cwd(),
)

describe('ensureJavaOnPath', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(path.join(os.tmpdir(), 'bazel java '))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it.skipIf(!java)('runs the installed Java executable', () => {
    expect(() => ensureJavaOnPath(getBazelEnvironment(), cwd)).not.toThrow()
  })

  it('reports missing Java in the supplied environment', () => {
    expect(() =>
      ensureJavaOnPath(getBazelEnvironment({ PATH: cwd, JAVA_HOME: '' }), cwd),
    ).toThrow(/Java is required/)
  })

  it('checks the supplied JAVA_HOME before PATH', () => {
    expect(() =>
      ensureJavaOnPath(
        getBazelEnvironment({ JAVA_HOME: path.join(cwd, 'missing jdk') }),
        cwd,
      ),
    ).toThrow(/JAVA_HOME/)
  })

  it.skipIf(!java)(
    'does not reuse a successful check with a different environment',
    () => {
      ensureJavaOnPath(getBazelEnvironment(), cwd)
      expect(() =>
        ensureJavaOnPath(
          getBazelEnvironment({ PATH: cwd, JAVA_HOME: '' }),
          cwd,
        ),
      ).toThrow(/Java is required/)
    },
  )
})
