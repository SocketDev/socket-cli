import {
  copyFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveBazelBinary } from './bazel-bin-detect.mts'
import { getBazelEnvironment } from './bazel-process.mts'

describe('resolveBazelBinary', () => {
  let cwd: string

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'bazel binaries ')))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5 })
  })

  function install(name: string): string {
    const bin = path.join(
      cwd,
      `${name}${process.platform === 'win32' ? '.exe' : ''}`,
    )
    copyFileSync(process.execPath, bin)
    return bin
  }

  it('resolves an explicit path relative to the scan directory', async () => {
    const bin = install('bazel')
    const resolved = await resolveBazelBinary(
      path.basename(bin),
      getBazelEnvironment(),
      cwd,
    )
    expect(statSync(resolved).ino).toBe(statSync(bin).ino)
  })

  it('preserves an explicit executable outside PATH', async () => {
    const bin = install('selected')
    const resolved = await resolveBazelBinary(
      bin,
      getBazelEnvironment({ PATH: '' }),
      cwd,
    )
    expect(statSync(resolved).ino).toBe(statSync(bin).ino)
  })

  it('prefers Bazelisk over Bazel', async () => {
    const bazelisk = install('bazelisk')
    install('bazel')
    const resolved = await resolveBazelBinary(
      undefined,
      getBazelEnvironment({ PATH: cwd }),
      cwd,
    )
    expect(statSync(resolved).ino).toBe(statSync(bazelisk).ino)
  })

  it('falls back to Bazel when Bazelisk is absent', async () => {
    const bazel = install('bazel')
    const resolved = await resolveBazelBinary(
      undefined,
      getBazelEnvironment({ PATH: cwd }),
      cwd,
    )
    expect(statSync(resolved).ino).toBe(statSync(bazel).ino)
  })

  it('finds tools in a quoted PATH entry', async () => {
    const bazel = install('bazel')
    const resolved = await resolveBazelBinary(
      undefined,
      getBazelEnvironment({ PATH: `"${cwd}"` }),
      os.tmpdir(),
    )
    expect(statSync(resolved).ino).toBe(statSync(bazel).ino)
  })

  it('reports missing tools', async () => {
    await expect(
      resolveBazelBinary(undefined, getBazelEnvironment({ PATH: cwd }), cwd),
    ).rejects.toThrow(/Could not find bazelisk or bazel/)
    await expect(
      resolveBazelBinary(path.join(cwd, 'missing'), getBazelEnvironment(), cwd),
    ).rejects.toThrow(/--bazel path does not exist/)
  })
})
