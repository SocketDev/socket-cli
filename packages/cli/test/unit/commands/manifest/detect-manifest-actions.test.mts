/**
 * Unit tests for detectManifestActions.
 *
 * Walks a directory looking for files that indicate which manifest
 * generators (sbt, gradle, conda) should run. Per-generator
 * `socket.json` `disabled` flags can suppress detection.
 *
 * Test Coverage:
 * - Empty directory → no detections, count 0
 * - build.sbt present → sbt=true, count 1
 * - gradlew present → gradle=true, count 1
 * - environment.yml present → conda=true, count 1
 * - environment.yaml present (when no .yml) → conda=true
 * - Both .yml and .yaml present → only counts once (yml wins)
 * - All three present → all true, count 3
 * - sockJson disables sbt → sbt=false even with build.sbt
 * - sockJson disables gradle → gradle=false even with gradlew
 * - sockJson disables conda → conda=false even with environment.yml
 * - cdxgen field is always false (not auto-detected)
 *
 * Related Files:
 * - src/commands/manifest/detect-manifest-actions.mts - Implementation
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SocketJson } from '../../../../src/util/socket/json.mts'

// Source-of-truth constants/paths.mts evaluates the bundle-tools.json
// version table at import time, which fails outside of a build (where
// INLINED_COANA_VERSION is missing). We only need ENVIRONMENT_YML /
// ENVIRONMENT_YAML, so stub them.
vi.mock('../../../../src/constants/paths.mjs', () => ({
  ENVIRONMENT_YAML: 'environment.yaml',
  ENVIRONMENT_YML: 'environment.yml',
}))

const { detectManifestActions } =
  await import('../../../../src/commands/manifest/detect-manifest-actions.mts')

let cwd = ''

beforeEach(() => {
  cwd = mkdtempSync(path.join(os.tmpdir(), 'detect-manifest-'))
})

afterEach(() => {
  rmSync(cwd, { force: true, recursive: true })
})

export function touch(rel: string) {
  const full = path.join(cwd, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, '')
}

describe('detectManifestActions', () => {
  it('returns all-false counts on an empty directory', async () => {
    const result = await detectManifestActions(undefined, cwd)
    expect(result).toEqual({
      cdxgen: false,
      count: 0,
      conda: false,
      gradle: false,
      sbt: false,
    })
  })

  it('detects build.sbt as Scala sbt project', async () => {
    touch('build.sbt')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.sbt).toBe(true)
    expect(result.count).toBe(1)
  })

  it('detects gradlew as Gradle project', async () => {
    touch('gradlew')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.gradle).toBe(true)
    expect(result.count).toBe(1)
  })

  it('detects environment.yml as Conda project', async () => {
    touch('environment.yml')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.conda).toBe(true)
    expect(result.count).toBe(1)
  })

  it('detects environment.yaml as Conda project when .yml is absent', async () => {
    touch('environment.yaml')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.conda).toBe(true)
    expect(result.count).toBe(1)
  })

  it('counts conda only once when both .yml and .yaml are present', async () => {
    touch('environment.yml')
    touch('environment.yaml')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.conda).toBe(true)
    expect(result.count).toBe(1)
  })

  it('detects all three when all marker files are present', async () => {
    touch('build.sbt')
    touch('gradlew')
    touch('environment.yml')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.sbt).toBe(true)
    expect(result.gradle).toBe(true)
    expect(result.conda).toBe(true)
    expect(result.count).toBe(3)
  })

  it('respects socket.json disabling sbt detection', async () => {
    touch('build.sbt')
    const sockJson = {
      defaults: { manifest: { sbt: { disabled: true } } },
    } as unknown as SocketJson
    const result = await detectManifestActions(sockJson, cwd)
    expect(result.sbt).toBe(false)
    expect(result.count).toBe(0)
  })

  it('respects socket.json disabling gradle detection', async () => {
    touch('gradlew')
    const sockJson = {
      defaults: { manifest: { gradle: { disabled: true } } },
    } as unknown as SocketJson
    const result = await detectManifestActions(sockJson, cwd)
    expect(result.gradle).toBe(false)
    expect(result.count).toBe(0)
  })

  it('respects socket.json disabling conda detection', async () => {
    touch('environment.yml')
    const sockJson = {
      defaults: { manifest: { conda: { disabled: true } } },
    } as unknown as SocketJson
    const result = await detectManifestActions(sockJson, cwd)
    expect(result.conda).toBe(false)
    expect(result.count).toBe(0)
  })

  it('always reports cdxgen as false (not auto-detected)', async () => {
    touch('build.sbt')
    touch('gradlew')
    touch('environment.yml')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.cdxgen).toBe(false)
  })

  it('ignores other socket.json keys when checking specific generators', async () => {
    // Only sbt is disabled; gradle and conda remain enabled.
    touch('build.sbt')
    touch('gradlew')
    touch('environment.yml')
    const sockJson = {
      defaults: { manifest: { sbt: { disabled: true } } },
    } as unknown as SocketJson
    const result = await detectManifestActions(sockJson, cwd)
    expect(result.sbt).toBe(false)
    expect(result.gradle).toBe(true)
    expect(result.conda).toBe(true)
    expect(result.count).toBe(2)
  })
})
