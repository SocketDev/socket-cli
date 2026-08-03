import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./discover-manifest-roots.mts', () => ({
  findBuildToolCandidates: vi.fn(),
  // Identity: test dirs are already-absolute plain strings, no symlinks involved.
  realpathOrResolved: vi.fn(async (dir: string) => dir),
}))
vi.mock('./detect-manifest-actions.mts', () => ({
  detectManifestActions: vi.fn(async () => ({
    bazel: false,
    cdxgen: false,
    count: 0,
    conda: false,
    gradle: false,
    maven: false,
    sbt: false,
  })),
}))
vi.mock('@socketsecurity/registry/lib/prompts', () => ({
  select: vi.fn(),
}))
vi.mock('./setup-manifest-config.mts', () => ({
  setupGradle: vi.fn(),
  setupMaven: vi.fn(),
  setupSbt: vi.fn(),
}))
vi.mock('../../utils/socket-json.mts', () => ({
  readOrDefaultSocketJson: vi.fn(),
  readSocketJsonCascade: vi.fn(),
  readSocketJsonSync: vi.fn(),
  writeSocketJson: vi.fn(),
}))

import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { detectManifestActions } from './detect-manifest-actions.mts'
import { findBuildToolCandidates } from './discover-manifest-roots.mts'
import { setupGradle, setupMaven, setupSbt } from './setup-manifest-config.mts'
import {
  configureCandidate,
  disableExclusionRoot,
  discoverBuildRoots,
  processCandidate,
  setupRecursiveManifestConfig,
  sortCandidatesForDisplay,
} from './setup-recursive-manifest-config.mts'
import {
  readOrDefaultSocketJson,
  readSocketJsonCascade,
  readSocketJsonSync,
  writeSocketJson,
} from '../../utils/socket-json.mts'

import type { SocketJson } from '../../utils/socket-json.mts'

function emptySockJson(): SocketJson {
  return { version: 1 } as SocketJson
}

// In-memory `dir -> own gradle section` store backing readSocketJsonCascade/
// readOrDefaultSocketJson/writeSocketJson, so a write made while processing
// one candidate is visible (via cascade) to a later candidate nested under
// it - the exact ordering behavior the "topmost only" tests exercise.
function makeFakeGradleDisk(cwd: string) {
  const store = new Map<string, Record<string, unknown>>()
  const ancestorsFarToNear = (dir: string): string[] => {
    const chain: string[] = []
    let current = dir
    while (current !== cwd) {
      chain.unshift(current)
      const parent = current.slice(0, current.lastIndexOf('/'))
      if (!parent || parent === current) {
        break
      }
      current = parent
    }
    return chain
  }
  return {
    readOrDefaultSocketJson: vi.fn((dir: string) => {
      const own = store.get(dir)
      return own
        ? ({
            version: 1,
            defaults: { manifest: { gradle: own } },
          } as SocketJson)
        : emptySockJson()
    }),
    readSocketJsonCascade: vi.fn((dir: string) => {
      let merged: Record<string, unknown> = {}
      for (const ancestor of ancestorsFarToNear(dir)) {
        const own = store.get(ancestor)
        if (own) {
          merged = { ...merged, ...own }
        }
      }
      return {
        version: 1,
        defaults: { manifest: { gradle: merged } },
      } as SocketJson
    }),
    writeSocketJson: vi.fn(async (dir: string, sockJson: SocketJson) => {
      store.set(
        dir,
        (sockJson.defaults?.manifest?.gradle as Record<string, unknown>) ?? {},
      )
      return { ok: true, data: undefined }
    }),
  }
}

describe('sortCandidatesForDisplay', () => {
  const cwd = '/repo'

  it('sorts shallower dirs before deeper ones, parent before child', () => {
    const sorted = sortCandidatesForDisplay(
      [
        { dir: '/repo/module-b/standalone-gradle-lib', ecosystems: ['gradle'] },
        { dir: '/repo/independent-service', ecosystems: ['maven'] },
      ],
      cwd,
    )
    expect(sorted).toEqual([
      { dir: '/repo/independent-service', ecosystems: ['maven'] },
      { dir: '/repo/module-b/standalone-gradle-lib', ecosystems: ['gradle'] },
    ])
  })
})

describe('discoverBuildRoots', () => {
  const cwd = '/repo'

  beforeEach(() => {
    vi.mocked(findBuildToolCandidates).mockReset()
  })

  it('excludes cwd itself', async () => {
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['gradle', [cwd]]]),
    )

    const result = await discoverBuildRoots({
      cwd,
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      excluded: [],
      included: [],
      totalCandidateCount: 0,
    })
  })

  it('marks a dir excluded when it is present in the full walk but absent from the excludePaths-filtered walk', async () => {
    const legacy = '/repo/legacy'
    const active = '/repo/active'
    vi.mocked(findBuildToolCandidates).mockImplementation(
      async ({ excludePaths }) =>
        excludePaths?.length
          ? new Map([['gradle', [active]]])
          : new Map([['gradle', [legacy, active]]]),
    )

    const result = await discoverBuildRoots({
      cwd,
      excludePaths: ['legacy'],
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      excluded: [{ dir: legacy, ecosystems: ['gradle'] }],
      included: [{ dir: active, ecosystem: 'gradle' }],
      totalCandidateCount: 2,
    })
  })

  it('groups sibling projects under a non-project excluded ancestor into a single exclusion root', async () => {
    // legacy/ itself has no build file of its own - only its two children do -
    // so it never appears as a candidate, but --exclude-paths=legacy should
    // still collapse both into one write at legacy, not two writes at
    // legacy/a and legacy/b.
    const a = '/repo/legacy/a'
    const b = '/repo/legacy/b'
    vi.mocked(findBuildToolCandidates).mockImplementation(
      async ({ excludePaths }) =>
        excludePaths?.length
          ? new Map([
              ['maven', []],
              ['gradle', []],
            ])
          : new Map([
              ['maven', [a]],
              ['gradle', [b]],
            ]),
    )

    const result = await discoverBuildRoots({
      cwd,
      excludePaths: ['legacy'],
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      excluded: [{ dir: '/repo/legacy', ecosystems: ['gradle', 'maven'] }],
      included: [],
      totalCandidateCount: 2,
    })
  })
})

describe('disableExclusionRoot', () => {
  const cwd = '/repo'
  const dir = '/repo/legacy'

  beforeEach(() => {
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockResolvedValue({ ok: true, data: undefined })
  })

  it('no-ops when the cascade already shows every ecosystem disabled', async () => {
    vi.mocked(readSocketJsonCascade).mockReturnValue({
      version: 1,
      defaults: { manifest: { gradle: { disabled: true } } },
    } as SocketJson)

    await disableExclusionRoot({
      cwd,
      dir,
      ecosystems: ['gradle'],
      rootSockJson: emptySockJson(),
    })

    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('writes disabled:true, preserving other own-file content', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: { manifest: { gradle: { bin: './gradlew' } } },
        }) as SocketJson,
    )

    await disableExclusionRoot({
      cwd,
      dir,
      ecosystems: ['gradle'],
      rootSockJson: emptySockJson(),
    })

    expect(writeSocketJson).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({
        defaults: {
          manifest: { gradle: { bin: './gradlew', disabled: true } },
        },
      }),
    )
  })

  it('writes only the ecosystems not already covered by cascade', async () => {
    vi.mocked(readSocketJsonCascade).mockReturnValue({
      version: 1,
      defaults: { manifest: { gradle: { disabled: true } } },
    } as SocketJson)
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())

    await disableExclusionRoot({
      cwd,
      dir,
      ecosystems: ['gradle', 'maven'],
      rootSockJson: emptySockJson(),
    })

    expect(writeSocketJson).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({
        defaults: { manifest: { maven: { disabled: true } } },
      }),
    )
  })
})

describe('configureCandidate', () => {
  const cwd = '/repo'
  const dir = '/repo/nested-gradle'

  beforeEach(() => {
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(setupGradle).mockReset()
  })

  it('seeds the sub-wizard with the cascaded value, own-file value winning, and writes the mutated result', async () => {
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: { manifest: { gradle: { javaHome: '/opt/jdk-17' } } },
        }) as SocketJson,
    )
    vi.mocked(readSocketJsonCascade).mockImplementation(
      () =>
        ({
          version: 1,
          defaults: {
            manifest: { gradle: { bin: './gradlew', javaHome: '/opt/jdk-11' } },
          },
        }) as SocketJson,
    )
    vi.mocked(setupGradle).mockImplementation(async config => {
      expect(config).toEqual({ bin: './gradlew', javaHome: '/opt/jdk-17' })
      ;(config as Record<string, unknown>)['gradleOpts'] = '--offline'
      return { ok: true, data: { canceled: false } }
    })

    const result = await configureCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(writeSocketJson).toHaveBeenCalledWith(
      dir,
      expect.objectContaining({
        defaults: {
          manifest: {
            gradle: {
              bin: './gradlew',
              javaHome: '/opt/jdk-17',
              gradleOpts: '--offline',
            },
          },
        },
      }),
    )
  })

  it('propagates a cancellation from the sub-wizard without writing', async () => {
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(setupGradle).mockResolvedValue({
      ok: true,
      data: { canceled: true },
    })

    const result = await configureCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({ ok: true, data: { canceled: true } })
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('writes nothing when nothing is inherited and every prompt is left blank', async () => {
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    // A no-op wizard: doesn't set a single field on the seed it's handed.
    vi.mocked(setupGradle).mockResolvedValue({
      ok: true,
      data: { canceled: false },
    })

    const result = await configureCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(writeSocketJson).not.toHaveBeenCalled()
  })
})

describe('processCandidate', () => {
  const cwd = '/repo'
  const dir = '/repo/legacy/nested'

  beforeEach(() => {
    vi.mocked(select).mockReset()
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())
    vi.mocked(writeSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(setupGradle).mockReset()
  })

  it('skips silently, without prompting, when the cascade already shows it disabled', async () => {
    vi.mocked(readSocketJsonCascade).mockReturnValue({
      version: 1,
      defaults: { manifest: { gradle: { disabled: true } } },
    } as SocketJson)

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'skipped' },
    })
    expect(select).not.toHaveBeenCalled()
  })

  it('does not offer a disable choice - that stays --exclude-paths-only', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(select).mockImplementation(async ({ choices }) => {
      expect(choices.map((c: { value: unknown }) => c.value)).toEqual([
        'inherit',
        'configure',
      ])
      return 'inherit'
    })

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'inherited' },
    })
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('configures the candidate when the user picks configure', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(select).mockResolvedValue('configure')
    vi.mocked(setupGradle).mockImplementation(async config => {
      ;(config as Record<string, unknown>)['bin'] = './gradlew'
      return { ok: true, data: { canceled: false } }
    })

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'configured' },
    })
    expect(setupGradle).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).toHaveBeenCalled()
  })

  it('leaves the candidate untouched when the user picks inherit', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(select).mockResolvedValue('inherit')

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result).toEqual({
      ok: true,
      data: { canceled: false, outcome: 'inherited' },
    })
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('reports a cancellation from the action prompt itself', async () => {
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(select).mockResolvedValue(null)

    const result = await processCandidate({
      cwd,
      dir,
      ecosystem: 'gradle',
      rootSockJson: emptySockJson(),
    })

    expect(result.ok && result.data.canceled).toBe(true)
    expect(writeSocketJson).not.toHaveBeenCalled()
  })
})

describe('setupRecursiveManifestConfig', () => {
  const cwd = '/repo'

  beforeEach(() => {
    vi.mocked(select).mockReset()
    // Default: decline all three root ecosystem questions ("No" x3), then
    // never reach the write-confirmation select at all (configuredAny stays
    // false) - matches the common case of a root with no baseline defaults.
    vi.mocked(select).mockResolvedValue(false)
    vi.mocked(setupGradle).mockReset()
    vi.mocked(setupMaven).mockReset()
    vi.mocked(setupSbt).mockReset()
    vi.mocked(readSocketJsonSync).mockReset()
    vi.mocked(readSocketJsonSync).mockImplementation(() => ({
      ok: true,
      data: emptySockJson(),
    }))
    vi.mocked(findBuildToolCandidates).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockReset()
    vi.mocked(readOrDefaultSocketJson).mockImplementation(() => emptySockJson())
    vi.mocked(readSocketJsonCascade).mockReset()
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    vi.mocked(writeSocketJson).mockReset()
    vi.mocked(writeSocketJson).mockResolvedValue({ ok: true, data: undefined })
    vi.mocked(detectManifestActions).mockReset()
    vi.mocked(detectManifestActions).mockResolvedValue({
      bazel: false,
      cdxgen: false,
      count: 0,
      conda: false,
      gradle: false,
      maven: false,
      sbt: false,
    })
  })

  it('proceeds to discovery when all three root ecosystem questions are declined', async () => {
    vi.mocked(select)
      // Configure Maven/Gradle/sbt? -> no, no, no.
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> yes.
      .mockResolvedValue(true)
    vi.mocked(findBuildToolCandidates).mockResolvedValue(new Map())

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(setupGradle).not.toHaveBeenCalled()
    expect(setupMaven).not.toHaveBeenCalled()
    expect(setupSbt).not.toHaveBeenCalled()
    expect(writeSocketJson).not.toHaveBeenCalled()
    expect(findBuildToolCandidates).toHaveBeenCalled()
  })

  it('asks about a detected ecosystem first, phrased as detected, before undetected ones', async () => {
    vi.mocked(detectManifestActions).mockResolvedValue({
      bazel: false,
      cdxgen: false,
      count: 1,
      conda: false,
      gradle: false,
      maven: true,
      sbt: false,
    })
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ message }) => {
      messages.push(message)
      return false
    })
    vi.mocked(findBuildToolCandidates).mockResolvedValue(new Map())

    await setupRecursiveManifestConfig(cwd, false)

    // Maven (detected) is asked about first, phrased as detected; Gradle and
    // sbt (undetected) follow, phrased as "anyway".
    expect(messages[0]).toMatch(/Maven was detected at this root/)
    expect(messages[1]).toMatch(/Gradle wasn't detected here.*anyway/)
    expect(messages[2]).toMatch(/sbt wasn't detected here.*anyway/)
  })

  it('skips discovery entirely when the user declines the recursive-discovery gate', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> no.
      .mockResolvedValue(false)

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(findBuildToolCandidates).not.toHaveBeenCalled()
  })

  it('configures maven at the root and writes it, then still proceeds to discovery', async () => {
    vi.mocked(select)
      // Configure Maven? -> yes.
      .mockResolvedValueOnce(true)
      // Configure Gradle? -> no.
      .mockResolvedValueOnce(false)
      // Configure sbt? -> no.
      .mockResolvedValueOnce(false)
      // Write the config? -> yes.
      .mockResolvedValueOnce(true)
    vi.mocked(setupMaven).mockImplementation(async config => {
      ;(config as Record<string, unknown>)['bin'] = './mvnw'
      return { ok: true, data: { canceled: false } }
    })
    vi.mocked(findBuildToolCandidates).mockResolvedValue(new Map())

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(setupMaven).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).toHaveBeenCalledWith(cwd, expect.any(Object))
  })

  it('does not write when the user says yes to configure Maven but leaves every prompt blank', async () => {
    vi.mocked(select)
      // Configure Maven? -> yes.
      .mockResolvedValueOnce(true)
      // Configure Gradle? -> no.
      .mockResolvedValueOnce(false)
      // Configure sbt? -> no.
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> no (never reaches the write-confirmation
      // select at all since nothing ended up configured).
      .mockResolvedValue(false)
    // A no-op wizard: doesn't set a single field.
    vi.mocked(setupMaven).mockResolvedValue({
      ok: true,
      data: { canceled: false },
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(setupMaven).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('stops when canceling one of the root ecosystem questions', async () => {
    vi.mocked(select).mockResolvedValueOnce(null)

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok && result.data.canceled).toBe(true)
    expect(findBuildToolCandidates).not.toHaveBeenCalled()
  })

  it('stops when a root ecosystem sub-wizard is canceled', async () => {
    vi.mocked(select).mockResolvedValueOnce(true)
    vi.mocked(setupMaven).mockResolvedValue({
      ok: true,
      data: { canceled: true },
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok && result.data.canceled).toBe(true)
    expect(findBuildToolCandidates).not.toHaveBeenCalled()
  })

  it('propagates a hard failure reading the root socket.json', async () => {
    vi.mocked(readSocketJsonSync).mockImplementation(() => ({
      ok: false,
      message: 'boom',
    }))

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result.ok).toBe(false)
    expect(findBuildToolCandidates).not.toHaveBeenCalled()
  })

  it('reports the discovered count and walks included candidates even when no --exclude-paths is given, instead of doing nothing', async () => {
    vi.mocked(select)
      // Configure Maven/Gradle/sbt? -> no, no, no.
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> yes.
      .mockResolvedValueOnce(true)
      // Candidate action prompt -> anything but 'disable'/'configure' is a
      // safe no-op (inherit), so this never touches writeSocketJson.
      .mockResolvedValue('inherit')
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['gradle', [`${cwd}/active`]]]),
    )
    vi.mocked(readSocketJsonCascade).mockImplementation(() => emptySockJson())
    const logSpy = vi.spyOn(logger, 'log')

    try {
      const result = await setupRecursiveManifestConfig(cwd, false)

      expect(result).toEqual({ ok: true, data: { canceled: false } })
      expect(writeSocketJson).not.toHaveBeenCalled()
      const logged = logSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).toMatch(/Found 1 build root\(s\) beneath/)
      expect(logged).toMatch(/0 configured, 1 left inheriting/)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('reports nothing excluded without writing anything', async () => {
    vi.mocked(select)
      // Configure Maven/Gradle/sbt? -> no, no, no.
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> yes.
      .mockResolvedValue(true)
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([['gradle', [`${cwd}/active`]]]),
    )

    const result = await setupRecursiveManifestConfig(cwd, false, ['legacy'])

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(findBuildToolCandidates).toHaveBeenCalled()
    expect(writeSocketJson).not.toHaveBeenCalled()
  })

  it('only writes disabled:true to the topmost of an excluded subtree', async () => {
    vi.mocked(select)
      // Configure Maven/Gradle/sbt? -> no, no, no.
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> yes.
      .mockResolvedValue(true)
    const legacy = `${cwd}/legacy`
    const nested = `${legacy}/nested`
    const fake = makeFakeGradleDisk(cwd)
    vi.mocked(readOrDefaultSocketJson).mockImplementation(
      fake.readOrDefaultSocketJson,
    )
    vi.mocked(readSocketJsonCascade).mockImplementation(
      fake.readSocketJsonCascade,
    )
    vi.mocked(writeSocketJson).mockImplementation(fake.writeSocketJson)
    vi.mocked(findBuildToolCandidates).mockImplementation(
      async ({ excludePaths }) =>
        excludePaths?.length
          ? new Map([['gradle', []]])
          : new Map([['gradle', [legacy, nested]]]),
    )

    const result = await setupRecursiveManifestConfig(cwd, false, ['legacy'])

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(writeSocketJson).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).toHaveBeenCalledWith(
      legacy,
      expect.objectContaining({
        defaults: { manifest: { gradle: { disabled: true } } },
      }),
    )
  })

  it('configures and leaves candidates inheriting in a single pass, skipping candidates already disabled via cascade', async () => {
    const serviceA = `${cwd}/serviceA`
    const serviceB = `${cwd}/serviceB`
    const serviceBSubmodule = `${serviceB}/submodule`
    const serviceC = `${cwd}/serviceC`

    vi.mocked(select)
      // Configure Maven/Gradle/sbt? -> no, no, no.
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      // Recursively discover...? -> yes.
      .mockResolvedValueOnce(true)
      // serviceA (depth 1) -> configure.
      .mockResolvedValueOnce('configure')
      // serviceC (depth 1) -> inherit.
      .mockResolvedValueOnce('inherit')
    // serviceB and serviceB/submodule are already disabled - via a prior
    // --exclude-paths run, say - so neither is ever prompted.
    vi.mocked(findBuildToolCandidates).mockResolvedValue(
      new Map([
        ['maven', [serviceA, serviceB, serviceBSubmodule]],
        ['gradle', [serviceC]],
      ]),
    )
    vi.mocked(readSocketJsonCascade).mockImplementation(dir =>
      dir === serviceB || dir === serviceBSubmodule
        ? ({
            version: 1,
            defaults: { manifest: { maven: { disabled: true } } },
          } as SocketJson)
        : emptySockJson(),
    )
    vi.mocked(setupMaven).mockImplementation(async config => {
      ;(config as Record<string, unknown>)['bin'] = './mvnw'
      return { ok: true, data: { canceled: false } }
    })

    const result = await setupRecursiveManifestConfig(cwd, false)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(select).toHaveBeenCalledTimes(6)
    expect(writeSocketJson).toHaveBeenCalledTimes(1)
    expect(writeSocketJson).toHaveBeenCalledWith(
      serviceA,
      expect.objectContaining({
        defaults: { manifest: { maven: { bin: './mvnw' } } },
      }),
    )
  })
})
