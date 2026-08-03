/**
 * Unit tests for detectManifestActions.
 *
 * Walks a directory looking for files that indicate which manifest generators
 * (bazel, sbt, gradle, maven, conda) should run. Per-generator `socket.json`
 * `disabled` flags can suppress detection.
 *
 * Test Coverage: - Empty directory → no detections, count 0 - build.sbt present
 * → sbt=true, count 1 - gradle build descriptors → gradle=true, count 1 -
 * pom.xml present → maven=true - Bazel workspace markers (root and nested) →
 * bazel=true - environment.yml present → conda=true, count 1 -
 * environment.yaml present (when no .yml) → conda=true - Both .yml and .yaml
 * present → only counts once yml wins - All present → all true - sockJson
 * disabled flags suppress each generator - cdxgen field is always false, not
 * auto-detected.
 *
 * Related Files: - src/commands/manifest/detect-manifest-actions.mts -
 * Implementation.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { detectManifestActions } from '../../../../src/commands/manifest/detect-manifest-actions.mts'

import type { SocketJson } from '../../../../src/util/socket/json.mts'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

let cwd = ''

beforeEach(() => {
  cwd = mkdtempSync(path.join(os.tmpdir(), 'detect-manifest-'))
})

afterEach(async () => {
  await safeDelete(cwd)
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
      bazel: false,
      cdxgen: false,
      count: 0,
      conda: false,
      gradle: false,
      maven: false,
      sbt: false,
    })
  })

  it('detects build.sbt as Scala sbt project', async () => {
    touch('build.sbt')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.sbt).toBe(true)
    expect(result.count).toBe(1)
  })

  it.each([
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
  ])('detects %s as Gradle project', async marker => {
    touch(marker)
    const result = await detectManifestActions(undefined, cwd)
    expect(result.gradle).toBe(true)
    expect(result.count).toBe(1)
  })

  it('does not detect gradle from the gradlew wrapper alone', async () => {
    // Detection keys on build descriptors, not the wrapper: a project can
    // build via `gradle` on PATH, and a wrapper with no build script is not a
    // runnable build.
    touch('gradlew')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.gradle).toBe(false)
    expect(result.count).toBe(0)
  })

  it('detects pom.xml as Maven project', async () => {
    touch('pom.xml')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.maven).toBe(true)
    expect(result.count).toBe(1)
  })

  it.each(['MODULE.bazel', 'WORKSPACE', 'WORKSPACE.bazel'])(
    'detects %s as Bazel workspace',
    async marker => {
      touch(marker)
      const result = await detectManifestActions(undefined, cwd)
      expect(result.bazel).toBe(true)
      expect(result.count).toBe(1)
    },
  )

  it('detects a nested-only Bazel workspace via the walker', async () => {
    touch('mobile/MODULE.bazel')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.bazel).toBe(true)
    expect(result.count).toBe(1)
  })

  it('does not detect a Bazel marker under a pruned directory', async () => {
    touch('node_modules/some-pkg/WORKSPACE')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.bazel).toBe(false)
    expect(result.count).toBe(0)
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

  it('detects every ecosystem when all marker files are present', async () => {
    touch('MODULE.bazel')
    touch('build.sbt')
    touch('build.gradle')
    touch('pom.xml')
    touch('environment.yml')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.bazel).toBe(true)
    expect(result.sbt).toBe(true)
    expect(result.gradle).toBe(true)
    expect(result.maven).toBe(true)
    expect(result.conda).toBe(true)
    expect(result.count).toBe(5)
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
    touch('build.gradle')
    const sockJson = {
      defaults: { manifest: { gradle: { disabled: true } } },
    } as unknown as SocketJson
    const result = await detectManifestActions(sockJson, cwd)
    expect(result.gradle).toBe(false)
    expect(result.count).toBe(0)
  })

  it('respects socket.json disabling maven detection', async () => {
    touch('pom.xml')
    const sockJson = {
      defaults: { manifest: { maven: { disabled: true } } },
    } as unknown as SocketJson
    const result = await detectManifestActions(sockJson, cwd)
    expect(result.maven).toBe(false)
    expect(result.count).toBe(0)
  })

  it('respects socket.json disabling bazel detection', async () => {
    touch('MODULE.bazel')
    const sockJson = {
      defaults: { manifest: { bazel: { disabled: true } } },
    } as unknown as SocketJson
    const result = await detectManifestActions(sockJson, cwd)
    expect(result.bazel).toBe(false)
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
    touch('build.gradle')
    touch('environment.yml')
    const result = await detectManifestActions(undefined, cwd)
    expect(result.cdxgen).toBe(false)
  })

  it('ignores other socket.json keys when checking specific generators', async () => {
    // Only sbt is disabled; gradle and conda remain enabled.
    touch('build.sbt')
    touch('build.gradle')
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
