import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { detectManifestActions } from './detect-manifest-actions.mts'

import type { SocketJson } from '../../utils/socket-json.mts'

function mkTmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'detect-manifest-bazel-'))
}

function touch(dir: string, name: string): void {
  writeFileSync(path.join(dir, name), '')
}

describe('detectManifestActions — bazel detector', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkTmp()
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('skips bazel when defaults.manifest.bazel.disabled is true', async () => {
    touch(cwd, 'MODULE.bazel')
    const result = await detectManifestActions(
      {
        defaults: { manifest: { bazel: { disabled: true } } },
      } as SocketJson,
      cwd,
    )
    expect(result.bazel).toBe(false)
    expect(result.count).toBe(0)
  })

  it('detects MODULE.bazel', async () => {
    touch(cwd, 'MODULE.bazel')
    const result = await detectManifestActions(null, cwd)
    expect(result.bazel).toBe(true)
    expect(result.count).toBe(1)
  })

  it('detects WORKSPACE', async () => {
    touch(cwd, 'WORKSPACE')
    const result = await detectManifestActions(null, cwd)
    expect(result.bazel).toBe(true)
  })

  it('detects WORKSPACE.bazel', async () => {
    touch(cwd, 'WORKSPACE.bazel')
    const result = await detectManifestActions(null, cwd)
    expect(result.bazel).toBe(true)
  })

  it('does not detect bazel when no marker present', async () => {
    const result = await detectManifestActions(null, cwd)
    expect(result.bazel).toBe(false)
    expect(result.count).toBe(0)
  })

  it('co-detects bazel and gradle when both markers are present', async () => {
    touch(cwd, 'MODULE.bazel')
    touch(cwd, 'build.gradle')
    const result = await detectManifestActions(null, cwd)
    expect(result.bazel).toBe(true)
    expect(result.gradle).toBe(true)
    expect(result.count).toBe(2)
  })
})

describe('detectManifestActions — gradle detector', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkTmp()
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('detects build.gradle', async () => {
    touch(cwd, 'build.gradle')
    const result = await detectManifestActions(null, cwd)
    expect(result.gradle).toBe(true)
    expect(result.count).toBe(1)
  })

  it('detects build.gradle.kts', async () => {
    touch(cwd, 'build.gradle.kts')
    const result = await detectManifestActions(null, cwd)
    expect(result.gradle).toBe(true)
    expect(result.count).toBe(1)
  })

  it('detects settings.gradle', async () => {
    touch(cwd, 'settings.gradle')
    const result = await detectManifestActions(null, cwd)
    expect(result.gradle).toBe(true)
    expect(result.count).toBe(1)
  })

  it('detects a settings-only Kotlin-DSL root (settings.gradle.kts, no build.gradle)', async () => {
    touch(cwd, 'settings.gradle.kts')
    touch(cwd, 'gradlew')
    const result = await detectManifestActions(null, cwd)
    expect(result.gradle).toBe(true)
  })

  it('detects a wrapper-less gradle project (build.gradle, no gradlew)', async () => {
    touch(cwd, 'build.gradle')
    const result = await detectManifestActions(null, cwd)
    expect(result.gradle).toBe(true)
  })

  it('does not detect gradle from a gradlew wrapper alone', async () => {
    touch(cwd, 'gradlew')
    const result = await detectManifestActions(null, cwd)
    expect(result.gradle).toBe(false)
    expect(result.count).toBe(0)
  })

  it('skips gradle when defaults.manifest.gradle.disabled is true', async () => {
    touch(cwd, 'build.gradle')
    const result = await detectManifestActions(
      {
        defaults: { manifest: { gradle: { disabled: true } } },
      } as SocketJson,
      cwd,
    )
    expect(result.gradle).toBe(false)
    expect(result.count).toBe(0)
  })
})

describe('detectManifestActions — conda detector', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkTmp()
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('detects environment.yml and reports it as the conda file', async () => {
    touch(cwd, 'environment.yml')
    const result = await detectManifestActions(null, cwd)
    expect(result.conda).toBe(true)
    expect(result.condaFile).toBe('environment.yml')
    expect(result.count).toBe(1)
  })

  it('detects environment.yaml and reports it as the conda file', async () => {
    touch(cwd, 'environment.yaml')
    const result = await detectManifestActions(null, cwd)
    expect(result.conda).toBe(true)
    expect(result.condaFile).toBe('environment.yaml')
    expect(result.count).toBe(1)
  })

  it('prefers environment.yml when both spellings exist', async () => {
    touch(cwd, 'environment.yaml')
    touch(cwd, 'environment.yml')
    const result = await detectManifestActions(null, cwd)
    expect(result.condaFile).toBe('environment.yml')
    expect(result.count).toBe(1)
  })

  it('reports no conda file when neither spelling exists', async () => {
    const result = await detectManifestActions(null, cwd)
    expect(result.conda).toBe(false)
    expect(result.condaFile).toBe('')
  })

  it('skips conda when defaults.manifest.conda.disabled is true', async () => {
    touch(cwd, 'environment.yaml')
    const result = await detectManifestActions(
      {
        defaults: { manifest: { conda: { disabled: true } } },
      } as SocketJson,
      cwd,
    )
    expect(result.conda).toBe(false)
    expect(result.condaFile).toBe('')
    expect(result.count).toBe(0)
  })
})
