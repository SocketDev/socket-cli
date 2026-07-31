import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

vi.mock('../../utils/socket-json.mts', () => ({
  readOrDefaultSocketJson: vi.fn(() => ({})),
  // Default: no per-root override found, fall back to the root config - matches
  // there being no nested socket.json anywhere in the fixture tree.
  readSocketJsonCascade: vi.fn((_dir, _boundaryDir, fallback) => fallback),
}))
vi.mock('./run-manifest-facts.mts', () => ({
  runManifestFacts: vi.fn(),
}))

import { generateRecursiveManifests } from './generate-recursive-manifests.mts'
import { runManifestFacts } from './run-manifest-facts.mts'
import { testPath } from '../../../test/utils.mts'
import { readSocketJsonCascade } from '../../utils/socket-json.mts'

const monorepo = path.join(
  testPath,
  'fixtures/commands/manifest/dynamic-sbom-inference/monorepo',
)
const reactor = path.join(monorepo, 'reactor')
const dualMarkerDir = path.join(monorepo, 'dual-marker-dir')

function relOf(dir: string): string {
  return path.relative(monorepo, dir).replaceAll('\\', '/')
}

describe('generateRecursiveManifests', () => {
  beforeEach(() => {
    vi.mocked(runManifestFacts).mockReset()
    vi.mocked(readSocketJsonCascade).mockImplementation(
      (_dir, _boundaryDir, fallback) => fallback,
    )
  })
  afterEach(() => {
    process.exitCode = undefined
  })

  it('invokes the reactor root once and skips its declared members, but still visits an undeclared nested submodule and a differently-tooled nested project', async () => {
    vi.mocked(runManifestFacts).mockImplementation(
      async ({ cwd, ecosystem }) => {
        if (cwd === reactor && ecosystem === 'maven') {
          return {
            factsPath: path.join(cwd, '.socket.facts.json'),
            projects: [
              {
                type: 'maven',
                name: 'moduleA',
                subprojectDir: 'moduleA',
                dependencies: [],
                resolvedAs: [],
              },
              {
                type: 'maven',
                name: 'moduleB',
                subprojectDir: 'moduleB',
                dependencies: [],
                resolvedAs: [],
              },
            ],
          }
        }
        return { factsPath: path.join(cwd, '.socket.facts.json'), projects: [] }
      },
    )

    const outcomes = await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const calledDirs = vi
      .mocked(runManifestFacts)
      .mock.calls.map(([opts]) => `${opts.ecosystem}:${relOf(opts.cwd)}`)
      .sort()
    expect(calledDirs).toEqual(
      [
        'gradle:dual-marker-dir',
        'gradle:reactor/moduleA/nested-gradle',
        'gradle:standalone-gradle',
        'maven:dual-marker-dir',
        'maven:reactor',
        'maven:reactor/moduleB/independent-submodule',
      ].sort(),
    )

    const skipped = outcomes
      .filter(o => o.status === 'skippedCovered')
      .map(o => `${o.ecosystem}:${relOf(o.dir)}`)
      .sort()
    expect(skipped).toEqual(
      ['maven:reactor/moduleA', 'maven:reactor/moduleB'].sort(),
    )
  })

  it("runs both ecosystems unconditionally at a dual-marker directory (matches auto's existing behavior)", async () => {
    vi.mocked(runManifestFacts).mockImplementation(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    const outcomes = await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const atDualMarkerDir = outcomes.filter(o => o.dir === dualMarkerDir)
    expect(atDualMarkerDir.map(o => o.ecosystem).sort()).toEqual([
      'gradle',
      'maven',
    ])
    expect(atDualMarkerDir.every(o => o.status === 'generated')).toBe(true)
  })

  it('continues to sibling roots in the same ecosystem after one root fails', async () => {
    vi.mocked(runManifestFacts).mockImplementation(
      async ({ cwd, ecosystem }) => {
        if (ecosystem === 'maven' && cwd === dualMarkerDir) {
          process.exitCode = 1
          return undefined
        }
        if (cwd === reactor && ecosystem === 'maven') {
          return {
            factsPath: path.join(cwd, '.socket.facts.json'),
            projects: [
              {
                type: 'maven',
                name: 'moduleA',
                subprojectDir: 'moduleA',
                dependencies: [],
                resolvedAs: [],
              },
            ],
          }
        }
        return { factsPath: path.join(cwd, '.socket.facts.json'), projects: [] }
      },
    )

    const outcomes = await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const byKey = new Map(
      outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
    )
    expect(byKey.get('maven:dual-marker-dir')).toBe('failed')
    // A failure at one maven root must not stop later maven roots from being attempted.
    expect(byKey.get('maven:reactor')).toBe('generated')
    expect(byKey.get('maven:reactor/moduleB/independent-submodule')).toBe(
      'generated',
    )
  })

  it('reports a non-fatal empty result distinctly from a failure', async () => {
    vi.mocked(runManifestFacts).mockImplementation(
      async ({ cwd, ecosystem }) => {
        if (ecosystem === 'maven' && cwd === dualMarkerDir) {
          // No resolvable dependencies; runManifestFacts warns but does not fail.
          return undefined
        }
        return { factsPath: path.join(cwd, '.socket.facts.json'), projects: [] }
      },
    )

    const outcomes = await generateRecursiveManifests({
      cwd: monorepo,
      verbose: false,
    })

    const byKey = new Map(
      outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
    )
    expect(byKey.get('maven:dual-marker-dir')).toBe('empty')
  })

  it('resolves each build root its own nearest socket.json instead of only the root config', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(
      (dir, _boundaryDir, fallback) =>
        dir === dualMarkerDir
          ? { defaults: { manifest: { maven: { javaHome: '/opt/jdk-11' } } } }
          : fallback,
    )
    vi.mocked(runManifestFacts).mockImplementation(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    await generateRecursiveManifests({ cwd: monorepo, verbose: false })

    const javaHomeByCall = new Map(
      vi
        .mocked(runManifestFacts)
        .mock.calls.map(([opts]) => [
          `${opts.ecosystem}:${relOf(opts.cwd)}`,
          opts.javaHome,
        ]),
    )
    expect(javaHomeByCall.get('maven:dual-marker-dir')).toBe('/opt/jdk-11')
    expect(javaHomeByCall.get('gradle:dual-marker-dir')).toBeUndefined()
    expect(javaHomeByCall.get('maven:reactor')).toBeUndefined()
  })

  it('warns but still generates facts when a resolved config sets facts: false', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(
      (dir, _boundaryDir, fallback) =>
        dir === dualMarkerDir
          ? { defaults: { manifest: { gradle: { facts: false } } } }
          : fallback,
    )
    vi.mocked(runManifestFacts).mockImplementation(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(warned).toMatch(/facts: false/)

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('gradle:dual-marker-dir')).toBe('generated')
    } finally {
      warnSpy.mockRestore()
    }
  })
})
