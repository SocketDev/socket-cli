import { execSync } from 'node:child_process' // gated test ONLY: detect tool prerequisites
// NOTE: mirrors the gating comment in extract_bazel_to_maven.constructed.test.mts —
// single permitted use of node:child_process for sandbox-aware skip predicate.
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateAutoManifest } from '../generate_auto_manifest.mts'

const FIXTURE = path.join(
  process.env['HOME'] as string,
  'src',
  'bazel-bench',
  'constructed',
  'java-maven',
)

function bazelAvailable(): boolean {
  try {
    execSync('bazelisk --version', { stdio: 'ignore' })
    return true
  } catch {
    try {
      execSync('bazel --version', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
}

function javaAvailable(): boolean {
  try {
    execSync('java -version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Probe whether the agent bash sandbox blocks bazel's runtime requirements:
// (a) write to /var/tmp/_bazel_${USER} (default --output_base path) and
// (b) bind to 127.0.0.1 (bazel's gRPC server). Per STATE.md 2026-05-06,
// sandboxed runs fail at one or both. `bazelisk --version` succeeds under
// sandbox (no fs/network), so a stronger probe is needed than just version.
function bazelSandboxOk(): boolean {
  try {
    const probeDir = path.join(
      '/var',
      'tmp',
      `_bazel_${process.env['USER'] ?? 'unknown'}`,
    )
    // mkdirSync is implicit via existsSync+writable check below.
    // Try to create the canonical default-output-base dir; if EPERM,
    // sandbox is blocking bazel's required write target.
    const fs = require('node:fs') as typeof import('node:fs')
    fs.mkdirSync(probeDir, { recursive: true })
    const sentinel = path.join(probeDir, '.sandbox-probe')
    fs.writeFileSync(sentinel, '')
    fs.unlinkSync(sentinel)
    return true
  } catch {
    return false
  }
}

describe('generateAutoManifest — bazel constructed fixture', () => {
  const skip =
    !bazelAvailable() ||
    !javaAvailable() ||
    !existsSync(FIXTURE) ||
    !bazelSandboxOk()

  it.skipIf(skip)(
    'writes outputs to .socket-auto-manifest/ and leaves the user-committed maven_install.json untouched',
    async () => {
      // Copy the constructed fixture into a writable tmp dir so the test does
      // not pollute ~/src/bazel-bench. Mirrors mkdtempSync usage in
      // extract_bazel_to_maven.constructed.test.mts.
      const tmpRoot = mkdtempSync(
        path.join(os.tmpdir(), 'auto-manifest-bazel-constructed-'),
      )
      const cwd = path.join(tmpRoot, 'java-maven')
      cpSync(FIXTURE, cwd, { recursive: true })

      // The constructed fixture ships with a checked-in `maven_install.json`
      // that bazel itself reads as the `rules_jvm_external` `lock_file` for
      // the @maven module extension. The whole point of the sibling-dir
      // layout is that the auto-manifest dispatcher must NOT overwrite this
      // file — snapshot mtime + content BEFORE the call and assert both are
      // unchanged AFTER, so we prove the dispatcher writes to its sidecar
      // dir instead.
      const userManifestPath = path.join(cwd, 'maven_install.json')
      const beforeMtimeMs = statSync(userManifestPath).mtimeMs
      const beforeContent = readFileSync(userManifestPath, 'utf8')

      await generateAutoManifest({
        cwd,
        detected: {
          bazel: true,
          cdxgen: false,
          conda: false,
          count: 1,
          gradle: false,
          sbt: false,
        },
        outputKind: 'text',
        verbose: !!process.env['VERBOSE_BAZEL_TEST'],
      })

      // The user's checked-in lockfile must be untouched — otherwise the
      // next `bazel sync` against `lock_file = "//:maven_install.json"` breaks.
      const afterStat = statSync(userManifestPath)
      expect(afterStat.mtimeMs).toBe(beforeMtimeMs)
      expect(readFileSync(userManifestPath, 'utf8')).toBe(beforeContent)

      // The dispatcher's output lands in the sibling dir.
      const sidecarDir = path.join(cwd, '.socket-auto-manifest')
      const generatedManifestPath = path.join(sidecarDir, 'maven_install.json')
      expect(existsSync(generatedManifestPath)).toBe(true)
      const parsed = JSON.parse(
        readFileSync(generatedManifestPath, 'utf8'),
      ) as { artifacts?: Record<string, unknown> }
      expect(parsed.artifacts).toBeDefined()
      expect(Object.keys(parsed.artifacts ?? {}).length).toBeGreaterThan(0)

      // No sidecar summary is written; verbose logs carry diagnostics instead.
      expect(
        existsSync(path.join(sidecarDir, 'socket-bazel-summary.json')),
      ).toBe(false)
      // No stray sidecar or wrapper directory at the cwd root.
      expect(existsSync(path.join(cwd, 'socket-bazel-summary.json'))).toBe(
        false,
      )
      expect(existsSync(path.join(cwd, '_whole_repo'))).toBe(false)

      // Cleanup
      rmSync(tmpRoot, { recursive: true, force: true })
    },
    // Long timeout — bazel cold-cache start is ~30–60s.
    180_000,
  )
})
