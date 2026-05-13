import { execSync } from 'node:child_process' // gated test ONLY: detect tool prerequisites; never used in production code
// NOTE: The line above is the single permitted use of node:child_process — it is confined to test setup
// (binary-availability detection) and runs nowhere near production code. We do NOT use it for spawning
// bazel itself.
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  detectWorkspaceMode,
  getBazelInvocationFlags,
} from './bazel-workspace-detect.mts'
import { extractBazelToMaven } from './extract_bazel_to_maven.mts'

const FIXTURE = path.join(
  process.env['HOME'] as string,
  'src',
  'bazel-bench',
  'constructed',
  'java-maven-legacy',
)
const INLINE_DECL_TRUTH = path.join(FIXTURE, 'expected-direct-decl.txt')

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

function checkInlineDeclCoverage(
  extracted: { artifacts?: Record<string, { version?: string }> },
  expectedLines: string[],
): { missing: string[] } {
  const missing: string[] = []
  for (const line of expectedLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const lastColon = trimmed.lastIndexOf(':')
    const ga = trimmed.slice(0, lastColon)
    const ver = trimmed.slice(lastColon + 1)
    const got = extracted.artifacts?.[ga]
    if (!got || got.version !== ver) {
      missing.push(
        trimmed +
          (got ? ` (got version ${got.version})` : ' (artifact key absent)'),
      )
    }
  }
  return { missing }
}

describe('extractBazelToMaven against ~/src/bazel-bench/constructed/java-maven-legacy', () => {
  const skip =
    !bazelAvailable() ||
    !javaAvailable() ||
    !existsSync(FIXTURE) ||
    !existsSync(INLINE_DECL_TRUTH)

  it.skipIf(skip)(
    'auto-detects legacy WORKSPACE and produces --noenable_bzlmod --enable_workspace flags',
    () => {
      // This test validates the auto-detection logic without running bazel.
      const mode = detectWorkspaceMode(FIXTURE)
      // Fixture has WORKSPACE but no MODULE.bazel => legacy-only.
      expect(mode.bzlmod).toBe(false)
      expect(mode.workspace).toBe(true)

      const flags = getBazelInvocationFlags(mode)
      expect(flags).toContain('--noenable_bzlmod')
      expect(flags).toContain('--enable_workspace')
    },
  )

  it.skipIf(skip)(
    'extracts artifacts and recovers all inline-decl entries',
    async () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'bazel-legacy-'))
      // Per-test bazel --output_base under tmp so vitest's parallel test
      // files do not collide on the default shared bazel server (each
      // workspace gets its own server keyed by output_base).
      const bazelOutputBase = path.join(tmp, '_bazel_ob')
      try {
        await extractBazelToMaven({
          bin: undefined,
          bazelFlags: undefined,
          bazelOutputBase,
          bazelRc: undefined,
          cwd: FIXTURE,
          out: tmp,
          verbose: !!process.env['VERBOSE_BAZEL_TEST'],
        })

        const extractedPath = path.join(tmp, 'maven_install.json')
        expect(existsSync(extractedPath)).toBe(true)
        const extracted = JSON.parse(readFileSync(extractedPath, 'utf8')) as {
          artifacts?: Record<string, { version?: string }>
        }

        const inlineDeclLines = readFileSync(INLINE_DECL_TRUTH, 'utf8').split(
          '\n',
        )
        const { missing: inlineMissing } = checkInlineDeclCoverage(
          extracted,
          inlineDeclLines,
        )

        // Commit extracted output as evidence.
        writeFileSync(
          path.join(tmp, 'java-maven-legacy-extracted.json'),
          JSON.stringify(extracted, null, 2),
          'utf8',
        )

        const diffLines: string[] = [
          `# socket manifest bazel — legacy-WORKSPACE constructed fixture diff`,
          `# Generated: ${new Date().toISOString()}`,
          `# Fixture: ${FIXTURE}`,
          ``,
          `Inline-decl ground truth: ${inlineDeclLines.filter(l => l.trim() && !l.trim().startsWith('#')).length} entries`,
          `Inline-decl artifacts NOT recovered: ${inlineMissing.length}`,
          ...inlineMissing.map(m => `  - ${m}`),
          ``,
          inlineMissing.length === 0
            ? `RESULT: LEGACY EXTRACTION OK + INLINE-DECL COVERED`
            : `RESULT: MISMATCH — extractor or auto-detection needs investigation`,
        ]
        writeFileSync(
          path.join(tmp, 'java-maven-legacy-diff.txt'),
          diffLines.join('\n'),
          'utf8',
        )

        // LOAD-BEARING — independent of the lockfile-derived ground truth.
        expect(inlineMissing).toEqual([])
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    },
    300_000,
  ) // 5-minute timeout for cold-cache bazel runs.
})
