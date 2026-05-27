import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  discoverAllCheckedInMavenArtifacts,
  findCheckedInMavenLockfiles,
  readCheckedInMavenLockfile,
} from './bazel-lockfile-discovery.mts'

// Minimal v2-lockfile shape (the canonical checked-in rules_jvm_external
// `maven_install.json`). We write distinct group:artifact:version triples per
// fixture so the merge logic has something measurable to dedupe.
function v2Lockfile(entries: Record<string, string>): string {
  const artifacts: Record<
    string,
    { shasums: { jar: string }; version: string }
  > = {}
  for (const [groupArtifact, version] of Object.entries(entries)) {
    artifacts[groupArtifact] = {
      shasums: { jar: 'a'.repeat(64) },
      version,
    }
  }
  return JSON.stringify({ artifacts, dependencies: {} })
}

describe('bazel-lockfile-discovery', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sock-bazel-lock-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  describe('findCheckedInMavenLockfiles', () => {
    it('finds lockfiles at root and arbitrary depth', () => {
      writeFileSync(path.join(tmp, 'maven_install.json'), v2Lockfile({}))
      mkdirSync(path.join(tmp, 'examples', 'dagger'), { recursive: true })
      writeFileSync(
        path.join(tmp, 'examples', 'dagger', 'maven_install.json'),
        v2Lockfile({}),
      )
      mkdirSync(path.join(tmp, 'examples', 'android', 'nested'), {
        recursive: true,
      })
      writeFileSync(
        path.join(tmp, 'examples', 'android', 'nested', 'maven_install.json'),
        v2Lockfile({}),
      )
      const found = findCheckedInMavenLockfiles(tmp).map(p =>
        path.relative(tmp, p),
      )
      expect(found).toEqual([
        'examples/android/nested/maven_install.json',
        'examples/dagger/maven_install.json',
        'maven_install.json',
      ])
    })

    it('prunes node_modules / .git / .socket-auto-manifest', () => {
      for (const dir of ['node_modules', '.git', '.socket-auto-manifest']) {
        mkdirSync(path.join(tmp, dir, 'sub'), { recursive: true })
        writeFileSync(
          path.join(tmp, dir, 'sub', 'maven_install.json'),
          v2Lockfile({}),
        )
      }
      // Sanity: a tracked lockfile alongside the pruned dirs is still found.
      writeFileSync(path.join(tmp, 'maven_install.json'), v2Lockfile({}))
      const found = findCheckedInMavenLockfiles(tmp).map(p =>
        path.relative(tmp, p),
      )
      expect(found).toEqual(['maven_install.json'])
    })

    it('prunes bazel-* convenience symlinks (output_base)', () => {
      // Simulate Bazel's `bazel-out` symlink pointing at a directory that
      // contains a generated copy of the same lockfile. The walk must skip
      // it; otherwise discovery would surface generated lockfiles from
      // <output_base> (tens of GiB of bazel state).
      const fakeOutputBase = mkdtempSync(
        path.join(os.tmpdir(), 'sock-fake-outbase-'),
      )
      try {
        mkdirSync(path.join(fakeOutputBase, 'external', 'maven'), {
          recursive: true,
        })
        writeFileSync(
          path.join(fakeOutputBase, 'external', 'maven', 'maven_install.json'),
          v2Lockfile({ 'com.example:generated': '1.0' }),
        )
        symlinkSync(fakeOutputBase, path.join(tmp, 'bazel-out'))
        writeFileSync(
          path.join(tmp, 'maven_install.json'),
          v2Lockfile({ 'com.example:checkedin': '1.0' }),
        )
        const found = findCheckedInMavenLockfiles(tmp).map(p =>
          path.relative(tmp, p),
        )
        expect(found).toEqual(['maven_install.json'])
      } finally {
        rmSync(fakeOutputBase, { recursive: true, force: true })
      }
    })
  })

  describe('readCheckedInMavenLockfile', () => {
    it('parses a v2 lockfile and tags sourceRepo with the relative dir', () => {
      mkdirSync(path.join(tmp, 'examples', 'dagger'), { recursive: true })
      const file = path.join(tmp, 'examples', 'dagger', 'maven_install.json')
      writeFileSync(
        file,
        v2Lockfile({
          'com.google.dagger:dagger': '2.50',
          'com.google.guava:guava': '33.0.0-jre',
        }),
      )
      const artifacts = readCheckedInMavenLockfile(file, tmp)
      expect(artifacts).toHaveLength(2)
      const coords = artifacts.map(a => a.mavenCoordinates).sort()
      expect(coords).toEqual([
        'com.google.dagger:dagger:2.50',
        'com.google.guava:guava:33.0.0-jre',
      ])
      for (const a of artifacts) {
        expect(a.sourceRepo).toBe('lockfile:examples/dagger')
      }
    })

    it('tags the root-cwd lockfile as lockfile:.', () => {
      const file = path.join(tmp, 'maven_install.json')
      writeFileSync(file, v2Lockfile({ 'com.example:a': '1.0' }))
      const artifacts = readCheckedInMavenLockfile(file, tmp)
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]?.sourceRepo).toBe('lockfile:.')
    })

    it('returns [] on malformed JSON without throwing', () => {
      const file = path.join(tmp, 'maven_install.json')
      writeFileSync(file, '{not valid json')
      expect(readCheckedInMavenLockfile(file, tmp)).toEqual([])
    })
  })

  describe('discoverAllCheckedInMavenArtifacts', () => {
    it('merges artifacts from every lockfile and dedupes by coordinates', () => {
      // Root lockfile pins guava 33.
      writeFileSync(
        path.join(tmp, 'maven_install.json'),
        v2Lockfile({ 'com.google.guava:guava': '33.0.0-jre' }),
      )
      // Sub-workspace A pins guava 33 (duplicate) AND dagger 2.50.
      mkdirSync(path.join(tmp, 'examples', 'dagger'), { recursive: true })
      writeFileSync(
        path.join(tmp, 'examples', 'dagger', 'maven_install.json'),
        v2Lockfile({
          'com.google.dagger:dagger': '2.50',
          'com.google.guava:guava': '33.0.0-jre',
        }),
      )
      // Sub-workspace B pins compose 1.6.
      mkdirSync(path.join(tmp, 'examples', 'jetpack_compose'), {
        recursive: true,
      })
      writeFileSync(
        path.join(tmp, 'examples', 'jetpack_compose', 'maven_install.json'),
        v2Lockfile({ 'androidx.compose.ui:ui': '1.6.0' }),
      )
      const { artifacts, lockfilePaths } =
        discoverAllCheckedInMavenArtifacts(tmp)
      expect(lockfilePaths).toHaveLength(3)
      const coords = artifacts.map(a => a.mavenCoordinates).sort()
      // Guava appears once even though it's pinned in two lockfiles.
      expect(coords).toEqual([
        'androidx.compose.ui:ui:1.6.0',
        'com.google.dagger:dagger:2.50',
        'com.google.guava:guava:33.0.0-jre',
      ])
    })

    it('emits the rules_kotlin shape: 1 root + several per-example lockfiles, strict superset', () => {
      // Stand-in for rules_kotlin's layout: a small root lockfile plus per-
      // example lockfiles that each declare some unique artifacts. The test
      // asserts the strict-superset property — merged artifact count is
      // greater than any single lockfile's count.
      writeFileSync(
        path.join(tmp, 'maven_install.json'),
        v2Lockfile(
          Object.fromEntries(
            Array.from({ length: 70 }, (_, i) => [
              `org.jetbrains.kotlin:lib-${i}`,
              '1.9.0',
            ]),
          ),
        ),
      )
      for (const example of [
        'android',
        'anvil',
        'dagger',
        'jetpack_compose',
        'ksp',
        'multiplex',
        'plugin',
      ]) {
        mkdirSync(path.join(tmp, 'examples', example), { recursive: true })
        writeFileSync(
          path.join(tmp, 'examples', example, 'maven_install.json'),
          v2Lockfile(
            Object.fromEntries(
              Array.from({ length: 73 }, (_, i) => [
                `com.example.${example}:lib-${i}`,
                '1.0',
              ]),
            ),
          ),
        )
      }
      const { artifacts, lockfilePaths } =
        discoverAllCheckedInMavenArtifacts(tmp)
      expect(lockfilePaths).toHaveLength(8)
      // Root has 70 unique; each of 7 examples has 73 unique disjoint sets.
      expect(artifacts.length).toBe(70 + 7 * 73)
      // Strict-superset of the root alone (which is what the CLI returns
      // today without sub-workspace discovery).
      expect(artifacts.length).toBeGreaterThan(70)
    })
  })
})
