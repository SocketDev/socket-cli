import { describe, expect, it, vi } from 'vitest'

// Simulates a real prompt: pressing Enter with nothing typed returns
// whatever `default` was shown - the same contract inquirer honors. This is
// exactly the behavior that made `askForBin` freeze a hardcoded tool
// fallback (e.g. 'mvn') into socket.json when the user never typed anything.
vi.mock('@socketsecurity/registry/lib/prompts', () => ({
  input: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
  select: vi.fn(async ({ default: def }: { default?: string }) => def ?? ''),
}))

import { setupGradle, setupMaven, setupSbt } from './setup-manifest-config.mts'

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
})
