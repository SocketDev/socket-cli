import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  discoverMavenRepos,
  parseMavenRepoCandidates,
  parseVisibleRepoCandidates,
  validateMavenRepo,
} from './bazel-repo-discovery.mts'

import type { RepoProbe } from './bazel-repo-discovery.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// from src/commands/manifest/bazel/ to repo root is four levels up, then into
// test/fixtures/manifest-bazel.
const FIXTURES = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'manifest-bazel',
)

const acceptingProbe: RepoProbe = async () => ({
  stdout:
    'jvm_import(\n  name = "guava",\n  maven_coordinates = "com.google.guava:guava:33.0.0-jre",\n)',
  code: 0,
})

const compactAcceptingProbe: RepoProbe = async () => ({
  stdout:
    'jvm_import(\n  name = "guava",\n  maven_coordinates="com.google.guava:guava:33.0.0-jre",\n)',
  code: 0,
})

const rejectingProbe: RepoProbe = async () => ({ stdout: '', code: 0 })

const failingProbe: RepoProbe = async () => ({ stdout: '', code: 1 })

const throwingProbe: RepoProbe = async () => {
  throw new Error('bazel exploded')
}

const selectiveProbe: RepoProbe = async name =>
  name === 'maven'
    ? { stdout: 'maven_coordinates=foo', code: 0 }
    : { stdout: '', code: 0 }

describe('bazel-repo-discovery', () => {
  describe('parseMavenRepoCandidates', () => {
    it('parses single use_repo from bzlmod-only', () => {
      expect(
        parseMavenRepoCandidates(path.join(FIXTURES, 'bzlmod-only')),
      ).toEqual(['maven'])
    })

    it('parses multiple names from multi-repo-bzlmod', () => {
      expect(
        parseMavenRepoCandidates(
          path.join(FIXTURES, 'multi-repo-bzlmod'),
        ).sort(),
      ).toEqual(['maven', 'maven_test'].sort())
    })

    it('recovers custom name from custom-name-bzlmod', () => {
      expect(
        parseMavenRepoCandidates(path.join(FIXTURES, 'custom-name-bzlmod')),
      ).toEqual(['maven_rules_kotlin_example'])
    })

    it('parses maven_install name from legacy WORKSPACE', () => {
      expect(
        parseMavenRepoCandidates(path.join(FIXTURES, 'legacy-only')),
      ).toEqual(['maven'])
    })

    it('parses maven_install name from sibling .bzl file (legacy-with-load)', () => {
      expect(
        parseMavenRepoCandidates(path.join(FIXTURES, 'legacy-with-load')),
      ).toEqual(['maven_legacy_app'])
    })

    it('parses repo names containing hyphens and dots from static sources', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-repos-'))
      try {
        writeFileSync(
          path.join(dir, 'MODULE.bazel'),
          'use_repo(maven, "maven-prod", "third.party.maven")\n',
        )
        writeFileSync(
          path.join(dir, 'WORKSPACE'),
          'maven_install(name = "legacy-maven.prod", artifacts = [])\n',
        )

        expect(parseMavenRepoCandidates(dir)).toEqual([
          'legacy-maven.prod',
          'maven-prod',
          'third.party.maven',
        ])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('returns empty array on a directory without bazel markers', () => {
      // Use the fixtures root itself: no MODULE.bazel/WORKSPACE there.
      expect(parseMavenRepoCandidates(FIXTURES)).toEqual([])
    })
  })

  describe('parseVisibleRepoCandidates', () => {
    it('parses apparent repo names from dump_repo_mapping JSON output', () => {
      const output = JSON.stringify({
        '': '',
        '@invalid': 'canonical-invalid',
        bazel_tools: 'bazel_tools',
        maven: 'rules_jvm_external~~maven~maven',
        'maven-prod': 'rules_jvm_external~~maven~prod',
        pypi: 'rules_python~~pip~pypi',
        'third.party.maven': 'rules_jvm_external~~maven~third_party',
      })

      expect(parseVisibleRepoCandidates(output)).toEqual([
        'bazel_tools',
        'maven',
        'maven-prod',
        'pypi',
        'third.party.maven',
      ])
    })

    it('parses apparent repo names from streamed jsonproto output', () => {
      const output = [
        JSON.stringify({
          repository: {
            apparentName: '@maven',
            canonicalName: 'rules_jvm_external~maven~maven',
          },
        }),
        JSON.stringify({
          repository: {
            apparent_name: 'maven_rules_kotlin_example',
            canonical_name: 'rules_jvm_external~maven~custom',
          },
        }),
        JSON.stringify({
          repository: {
            apparentName: '@maven-prod',
            canonicalName: 'rules_jvm_external~maven~prod',
          },
        }),
        JSON.stringify({
          repository: {
            apparentName: 'third.party.maven',
            canonicalName: 'rules_jvm_external~maven~third_party',
          },
        }),
        'not json',
      ].join('\n')

      expect(parseVisibleRepoCandidates(output)).toEqual([
        'maven',
        'maven-prod',
        'maven_rules_kotlin_example',
        'third.party.maven',
      ])
    })
  })

  describe('validateMavenRepo', () => {
    it('accepts when probe stdout contains spaced maven_coordinates output', async () => {
      const r = await validateMavenRepo('maven', acceptingProbe)
      expect(r.valid).toBe(true)
      expect(r.stdout).toContain('maven_coordinates')
    })

    it('accepts when probe stdout contains compact maven_coordinates output', async () => {
      const r = await validateMavenRepo('maven', compactAcceptingProbe)
      expect(r.valid).toBe(true)
      expect(r.stdout).toContain('maven_coordinates')
    })

    it('rejects when probe stdout lacks maven_coordinates=', async () => {
      expect((await validateMavenRepo('not_maven', rejectingProbe)).valid).toBe(
        false,
      )
    })

    it('rejects on non-zero exit code', async () => {
      expect(
        (await validateMavenRepo('also_not_maven', failingProbe)).valid,
      ).toBe(false)
    })

    it('rejects when probe throws', async () => {
      expect((await validateMavenRepo('crash', throwingProbe)).valid).toBe(
        false,
      )
    })
  })

  describe('discoverMavenRepos', () => {
    it('returns parsed candidates that the probe validates, with cached probe stdout', async () => {
      // multi-repo-bzlmod parses to ['maven', 'maven_test']; the accepting probe
      // validates both. The returned Map carries the probe stdout for each.
      const result = await discoverMavenRepos(
        path.join(FIXTURES, 'multi-repo-bzlmod'),
        acceptingProbe,
      )
      expect(Array.from(result.keys()).sort()).toEqual(
        ['maven', 'maven_test'].sort(),
      )
      for (const stdout of result.values()) {
        expect(stdout).toContain('maven_coordinates')
      }
    })

    it('uses native visible repo candidates instead of static parsing when provided', async () => {
      const result = await discoverMavenRepos(
        path.join(FIXTURES, 'multi-repo-bzlmod'),
        acceptingProbe,
        ['native_maven'],
      )
      expect(Array.from(result.keys())).toEqual(['maven', 'native_maven'])
    })

    it('filters out candidates the probe rejects', async () => {
      // Probe accepts only when repo name === 'maven'; rejects 'maven_test'.
      const result = await discoverMavenRepos(
        path.join(FIXTURES, 'multi-repo-bzlmod'),
        selectiveProbe,
      )
      expect(Array.from(result.keys())).toEqual(['maven'])
    })
  })

  describe('verbose diagnostics', () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      logSpy = vi.spyOn(logger, 'log').mockImplementation(() => logger)
    })

    afterEach(() => {
      logSpy.mockRestore()
    })

    function loggedLines(): string {
      return logSpy.mock.calls
        .map(args => args.map(a => String(a)).join(' '))
        .join('\n')
    }

    it('parseMavenRepoCandidates stays silent when verbose is unset', () => {
      parseMavenRepoCandidates(path.join(FIXTURES, 'multi-repo-bzlmod'))
      expect(logSpy).not.toHaveBeenCalled()
    })

    it('parseMavenRepoCandidates emits scanned-files + candidate set when verbose=true', () => {
      parseMavenRepoCandidates(path.join(FIXTURES, 'multi-repo-bzlmod'), true)
      const text = loggedLines()
      expect(text).toContain('discovery: scanned')
      expect(text).toContain('MODULE.bazel')
      expect(text).toContain('use_repo match')
      expect(text).toContain('candidate set (pre-seed)')
    })

    it('validateMavenRepo logs ACCEPT under verbose', async () => {
      await validateMavenRepo('maven', acceptingProbe, true)
      expect(loggedLines()).toMatch(
        /probe @maven:\s*ACCEPT \(maven_coordinates marker found\)/,
      )
    })

    it('validateMavenRepo logs REJECT (no marker) under verbose', async () => {
      await validateMavenRepo('not_maven', rejectingProbe, true)
      expect(loggedLines()).toMatch(/probe @not_maven:\s*REJECT/)
    })

    it('validateMavenRepo logs REJECT (probe threw) under verbose', async () => {
      await validateMavenRepo('crash', throwingProbe, true)
      expect(loggedLines()).toMatch(/probe @crash:\s*REJECT \(probe threw\)/)
    })

    it('discoverMavenRepos propagates verbose into the full pipeline', async () => {
      await discoverMavenRepos(
        path.join(FIXTURES, 'multi-repo-bzlmod'),
        selectiveProbe,
        undefined,
        true,
      )
      const text = loggedLines()
      // Candidate-source label.
      expect(text).toContain('candidate source: static parse')
      // Seeded-and-deduped candidate set log.
      expect(text).toContain('candidate set to probe')
      // Per-candidate probe verdicts.
      expect(text).toMatch(/probe @maven:\s*ACCEPT/)
      expect(text).toMatch(/probe @maven_test:\s*REJECT/)
      // Final validated set.
      expect(text).toContain('validated repos')
    })
  })

  describe('DoS guard', () => {
    it('completes parse on 1MB pathological input within 1s', () => {
      // Synthesize a 1MB Bzlmod-shaped file in a tmp dir and feed it through
      // parseMavenRepoCandidates. Exercises the bounded USE_REPO_RE +
      // QUOTED_NAME_RE windows.
      const dir = mkdtempSync(path.join(os.tmpdir(), 'bazel-discover-'))
      try {
        // Build the fixture content in a single pass (avoid O(n^2) join-in-loop).
        const lines: string[] = []
        let totalLen = 0
        while (totalLen < 1_000_000) {
          const line = 'use_repo(maven, "x_' + lines.length + '")'
          lines.push(line)
          // Plus 1 for the eventual newline separator.
          totalLen += line.length + 1
        }
        writeFileSync(path.join(dir, 'MODULE.bazel'), lines.join('\n'))
        const start = process.hrtime.bigint()
        const result = parseMavenRepoCandidates(dir)
        const elapsed = process.hrtime.bigint() - start
        expect(elapsed).toBeLessThan(1_000_000_000n)
        // Verify the cap kicks in (length is bounded by MAX_CANDIDATES).
        expect(result.length).toBeLessThanOrEqual(256)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
