import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
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
import {
  readOrDefaultSocketJson,
  readSocketJsonCascade,
} from '../../utils/socket-json.mts'

import type { SocketJson } from '../../utils/socket-json.mts'

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
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({} as SocketJson)
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

  it('aborts only the failing ecosystem (fail-closed), marking its remaining candidates aborted, while an unrelated ecosystem proceeds normally', async () => {
    vi.mocked(runManifestFacts).mockImplementation(
      async ({ cwd, ecosystem }) => {
        if (ecosystem === 'maven' && cwd === dualMarkerDir) {
          process.exitCode = 1
          return null
        }
        return { factsPath: path.join(cwd, '.socket.facts.json'), projects: [] }
      },
    )
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:dual-marker-dir')).toBe('failed')
      // Without dual-marker-dir's own projects[], reactor's still-undiscovered
      // members can't be safely told apart from independent projects - so
      // nothing else in the maven ecosystem gets attempted, but that's now
      // reported explicitly rather than silently omitted.
      expect(byKey.get('maven:reactor')).toBe('aborted')
      expect(byKey.get('maven:reactor/moduleB/independent-submodule')).toBe(
        'aborted',
      )
      expect(
        vi
          .mocked(runManifestFacts)
          .mock.calls.some(
            ([opts]) => opts.ecosystem === 'maven' && opts.cwd === reactor,
          ),
      ).toBe(false)
      // Coverage is tracked per ecosystem, so maven's failure has nothing to
      // do with gradle's - it still runs to completion at the same directory.
      expect(byKey.get('gradle:dual-marker-dir')).toBe('generated')
      expect(
        warnSpy.mock.calls.some(c =>
          /Aborting maven discovery/.test(String(c[0])),
        ),
      ).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('still classifies a failure as failed (not empty) when process.exitCode was already non-zero beforehand', async () => {
    process.exitCode = 1
    vi.mocked(runManifestFacts).mockImplementation(
      async ({ cwd, ecosystem }) => {
        if (ecosystem === 'maven' && cwd === dualMarkerDir) {
          process.exitCode = 1
          return null
        }
        return { factsPath: path.join(cwd, '.socket.facts.json'), projects: [] }
      },
    )
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)

    try {
      const outcomes = await generateRecursiveManifests({
        cwd: monorepo,
        verbose: false,
      })

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:dual-marker-dir')).toBe('failed')
    } finally {
      warnSpy.mockRestore()
    }
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

  it('resolves an explicit null override back to the no-restriction default, not a literal null', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(
      (dir, _boundaryDir, fallback) =>
        dir === dualMarkerDir
          ? {
              defaults: {
                manifest: { maven: { excludeConfigs: null, javaHome: null } },
              },
            }
          : fallback,
    )
    vi.mocked(runManifestFacts).mockImplementation(async ({ cwd }) => ({
      factsPath: path.join(cwd, '.socket.facts.json'),
      projects: [],
    }))

    await generateRecursiveManifests({ cwd: monorepo, verbose: false })

    const call = vi
      .mocked(runManifestFacts)
      .mock.calls.find(
        ([opts]) => opts.cwd === dualMarkerDir && opts.ecosystem === 'maven',
      )
    expect(call?.[0].excludeConfigs).toBe('')
    expect(call?.[0].javaHome).toBeUndefined()
  })

  it('skips (with a warning) a resolved config that sets facts: false, never invoking the build tool', async () => {
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
      expect(warned).toMatch(/facts is false/)

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('gradle:dual-marker-dir')).toBe('skippedDisabled')
      expect(
        vi
          .mocked(runManifestFacts)
          .mock.calls.some(
            ([opts]) =>
              opts.cwd === dualMarkerDir && opts.ecosystem === 'gradle',
          ),
      ).toBe(false)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('shortens the cascade walk for a nested candidate under an already-disabled root, instead of re-walking from cwd', async () => {
    const independentSubmodule = path.join(
      reactor,
      'moduleB',
      'independent-submodule',
    )
    // Maven-only candidates nested under reactor; excludes the differently-
    // tooled reactor/moduleA/nested-gradle, which is its own gradle-ecosystem
    // candidate never marked disabled and correctly still walks from cwd.
    const nestedMavenDirs = new Set([
      path.join(reactor, 'moduleA'),
      path.join(reactor, 'moduleB'),
      independentSubmodule,
    ])
    vi.mocked(readSocketJsonCascade).mockImplementation(
      (dir, boundaryDir, fallback) => {
        if (dir === reactor && boundaryDir === monorepo) {
          // The one full walk: reactor's own socket.json disables maven.
          return { defaults: { manifest: { maven: { disabled: true } } } }
        }
        // Every other maven candidate nested under reactor must use a
        // boundary nearer than the overall recursion root - never re-walk
        // all the way back to monorepo/rootSockJson once an ancestor is
        // already confirmed disabled.
        if (nestedMavenDirs.has(dir)) {
          expect(boundaryDir).not.toBe(monorepo)
        }
        return fallback
      },
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

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:reactor')).toBe('skippedDisabled')
      expect(byKey.get('maven:reactor/moduleB/independent-submodule')).toBe(
        'skippedDisabled',
      )
      expect(
        vi
          .mocked(runManifestFacts)
          .mock.calls.some(
            ([opts]) =>
              opts.ecosystem === 'maven' &&
              opts.cwd.startsWith(reactor) &&
              opts.cwd !== independentSubmodule,
          ),
      ).toBe(false)
      // Four maven candidates end up skippedDisabled (reactor + moduleA +
      // moduleB + independent-submodule), but only the root cause should
      // warn - otherwise a big disabled reactor spams one line per pom.
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/disabled is true/)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('still honors a nested override that re-enables a build root under an otherwise-disabled ancestor', async () => {
    const independentSubmodule = path.join(
      reactor,
      'moduleB',
      'independent-submodule',
    )
    vi.mocked(readSocketJsonCascade).mockImplementation(
      (dir, _boundaryDir, fallback) => {
        if (dir === reactor) {
          return { defaults: { manifest: { maven: { disabled: true } } } }
        }
        if (dir === independentSubmodule) {
          // Its own socket.json explicitly clears the inherited disable.
          return { defaults: { manifest: { maven: { disabled: false } } } }
        }
        return fallback
      },
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

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:reactor')).toBe('skippedDisabled')
      expect(byKey.get('maven:reactor/moduleB/independent-submodule')).toBe(
        'generated',
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('still discovers a build root when the root socket.json disables its whole ecosystem, so a nested override can re-enable it', async () => {
    vi.mocked(readOrDefaultSocketJson).mockReturnValue({
      defaults: { manifest: { maven: { disabled: true } } },
    } as SocketJson)
    vi.mocked(readSocketJsonCascade).mockImplementation(
      (dir, _boundaryDir, fallback) =>
        dir === reactor
          ? { defaults: { manifest: { maven: { disabled: false } } } }
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

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      // Root-disabled maven is still scanned for at all (not dropped
      // entirely), so the nested override is actually found and generated.
      expect(byKey.get('maven:reactor')).toBe('generated')
      expect(byKey.get('maven:dual-marker-dir')).toBe('skippedDisabled')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('skips (with a warning) a resolved config that sets a cascaded disabled: true', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(
      (dir, _boundaryDir, fallback) =>
        dir === reactor
          ? { defaults: { manifest: { maven: { disabled: true } } } }
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
      expect(warned).toMatch(/disabled is true/)

      const byKey = new Map(
        outcomes.map(o => [`${o.ecosystem}:${relOf(o.dir)}`, o.status]),
      )
      expect(byKey.get('maven:reactor')).toBe('skippedDisabled')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('bounds the socket.json cascade at a symlinked cwd instead of walking past it to the real filesystem root', async () => {
    const actual = await vi.importActual<
      typeof import('../../utils/socket-json.mts')
    >('../../utils/socket-json.mts')
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      actual.readOrDefaultSocketJson,
    )
    vi.mocked(readSocketJsonCascade).mockImplementation(
      actual.readSocketJsonCascade,
    )

    const outer = await fs.mkdtemp(path.join(tmpdir(), 'symlink-cascade-'))
    const realCwd = path.join(outer, 'real-cwd')
    const cwdLink = path.join(outer, 'cwd-link')
    const project = path.join(realCwd, 'project')
    try {
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(path.join(project, 'pom.xml'), '<project/>')
      // Sits strictly above the intended recursion root - must never be read.
      await fs.writeFile(
        path.join(outer, 'socket.json'),
        JSON.stringify({
          version: 1,
          defaults: { manifest: { maven: { bin: 'LEAKED-BIN' } } },
        }),
      )
      await fs.symlink(realCwd, cwdLink)

      vi.mocked(runManifestFacts).mockImplementation(async ({ bin, cwd }) => {
        expect(bin).not.toBe('LEAKED-BIN')
        return {
          factsPath: path.join(cwd, '.socket.facts.json'),
          projects: [],
        }
      })

      const outcomes = await generateRecursiveManifests({
        cwd: cwdLink,
        verbose: false,
      })

      expect(outcomes.some(o => o.status === 'generated')).toBe(true)
      expect(runManifestFacts).toHaveBeenCalled()
    } finally {
      await fs.rm(outer, { recursive: true, force: true })
    }
  })
})
