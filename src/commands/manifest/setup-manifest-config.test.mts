import { describe, expect, it, vi } from 'vitest'

// Simulates a real prompt: pressing Enter with nothing typed returns
// whatever `default` was shown - the same contract inquirer honors. This is
// exactly the behavior that made `askForBin` freeze a hardcoded tool
// fallback (e.g. 'mvn') into socket.json when the user never typed anything.
vi.mock('@socketsecurity/registry/lib/prompts', () => ({
  input: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
  select: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
}))

import { input, select } from '@socketsecurity/registry/lib/prompts'

import {
  setupDotnet,
  setupGradle,
  setupMaven,
  setupSbt,
} from './setup-manifest-config.mts'

describe('setupGradle/setupMaven/setupSbt', () => {
  it('leaves bin unset on a fresh config when every prompt is left blank, instead of freezing the hardcoded fallback', async () => {
    const gradleConfig: Record<string, unknown> = {}
    const mavenConfig: Record<string, unknown> = {}
    const sbtConfig: Record<string, unknown> = {}

    const gradleResult = await setupGradle(gradleConfig)
    const mavenResult = await setupMaven(mavenConfig)
    const sbtResult = await setupSbt(sbtConfig)

    expect(gradleResult).toEqual({ ok: true, data: { canceled: false } })
    expect(mavenResult).toEqual({ ok: true, data: { canceled: false } })
    expect(sbtResult).toEqual({ ok: true, data: { canceled: false } })
    expect(gradleConfig['bin']).toBeUndefined()
    expect(mavenConfig['bin']).toBeUndefined()
    expect(sbtConfig['bin']).toBeUndefined()
  })

  it('still shows and accepts a prior explicit bin value unchanged', async () => {
    const config: Record<string, unknown> = { bin: './custom-gradlew' }

    await setupGradle(config)

    expect(config['bin']).toBe('./custom-gradlew')
  })

  it('preserves an explicit null (already-cleared) field on a blank re-prompt, instead of deleting it back into inheriting', async () => {
    const config: Record<string, unknown> = {
      bin: null,
      gradleOpts: null,
      javaHome: null,
    }

    await setupGradle(config)

    expect(config['bin']).toBeNull()
    expect(config['javaHome']).toBeNull()
    expect(config['gradleOpts']).toBeNull()
  })

  it('asks the facts/pom question by default', async () => {
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ default: def, message }) => {
      messages.push(message)
      return def ?? ''
    })

    await setupGradle({})
    await setupSbt({})

    expect(messages.some(m => m.includes('--facts / --pom'))).toBe(true)
  })

  it('skips the facts/pom question entirely when factsOnly is set, going straight to facts-only options', async () => {
    const messages: string[] = []
    vi.mocked(select).mockImplementation(async ({ default: def, message }) => {
      messages.push(message)
      return def ?? ''
    })

    await setupGradle({}, { factsOnly: true })
    await setupSbt({}, { factsOnly: true })

    expect(messages.some(m => m.includes('--facts / --pom'))).toBe(false)
    // The facts-only options (config filters) still ask, just without the
    // facts/pom choice gating them.
    expect(messages.some(m => m.includes('--ignore-unresolved'))).toBe(true)
  })
})

describe('setupDotnet', () => {
  it('leaves a fresh config empty when every prompt is left blank', async () => {
    const config: Record<string, unknown> = {}

    const result = await setupDotnet(config)

    expect(result).toEqual({ ok: true, data: { canceled: false } })
    expect(config).toEqual({})
  })

  it('preserves explicit nulls on a blank re-prompt', async () => {
    const config: Record<string, unknown> = { bin: null, dotnetOpts: null }

    await setupDotnet(config)

    expect(config['bin']).toBeNull()
    expect(config['dotnetOpts']).toBeNull()
  })

  it('asks for target framework filters, never the facts/pom choice', async () => {
    vi.mocked(input).mockClear()
    vi.mocked(select).mockClear()

    await setupDotnet({})

    const messages = [
      ...vi.mocked(input).mock.calls,
      ...vi.mocked(select).mock.calls,
    ].map(c => c[0].message)
    expect(messages.some(m => m.includes('--dotnet-opts'))).toBe(true)
    expect(messages.some(m => m.includes('target framework globs'))).toBe(true)
    expect(messages.some(m => m.includes('--ignore-unresolved'))).toBe(true)
    expect(messages.some(m => m.includes('--facts / --pom'))).toBe(false)
  })
})
