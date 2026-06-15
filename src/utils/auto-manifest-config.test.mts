import { describe, expect, it } from 'vitest'

import {
  AUTO_MANIFEST_CONFIG_MIN_COANA_VERSION,
  buildAutoManifestConfig,
  coanaSupportsAutoManifestConfig,
  isAutoManifestConfigEmpty,
} from './auto-manifest-config.mts'

import type { SocketJson } from './socket-json.mts'

// Builds a minimal SocketJson for the mapping under test; only
// `defaults.manifest` is read, so the header/version fields are irrelevant.
function socketJson(
  manifest?: NonNullable<NonNullable<SocketJson['defaults']>['manifest']>,
): SocketJson {
  return { defaults: { manifest } } as SocketJson
}

describe('buildAutoManifestConfig', () => {
  it('returns an empty config for plain --reach with no manifest defaults', () => {
    expect(
      buildAutoManifestConfig(socketJson(), { autoManifest: false }),
    ).toEqual({})
  })

  it('sets top-level failOnBuildToolError=true under --auto-manifest (fail-closed)', () => {
    expect(
      buildAutoManifestConfig(socketJson(), { autoManifest: true }),
    ).toEqual({ failOnBuildToolError: true })
  })

  it('leaves failOnBuildToolError unset on plain --reach (Coana default permissive)', () => {
    const config = buildAutoManifestConfig(
      socketJson({ gradle: { bin: './gradlew' } }),
      { autoManifest: false },
    )
    expect(config.failOnBuildToolError).toBeUndefined()
  })

  it('maps gradle/sbt options, *Opts -> opts, ignoreUnresolved passthrough', () => {
    const config = buildAutoManifestConfig(
      socketJson({
        gradle: {
          bin: './gradlew',
          excludeConfigs: 'testCompileClasspath',
          gradleOpts: '--offline --no-daemon',
          ignoreUnresolved: true,
          includeConfigs: '*RuntimeClasspath',
        },
        sbt: { bin: 'sbt', sbtOpts: '-batch' },
      }),
      { autoManifest: true },
    )
    expect(config).toEqual({
      failOnBuildToolError: true,
      gradle: {
        bin: './gradlew',
        excludeConfigs: 'testCompileClasspath',
        ignoreUnresolved: true,
        includeConfigs: '*RuntimeClasspath',
        opts: ['--offline', '--no-daemon'],
      },
      sbt: { bin: 'sbt', opts: ['-batch'] },
    })
  })

  it('omits disabled ecosystems so they fall back to Coana defaults', () => {
    const config = buildAutoManifestConfig(
      socketJson({
        gradle: { disabled: true, includeConfigs: '*RuntimeClasspath' },
        sbt: { bin: 'sbt' },
      }),
      { autoManifest: false },
    )
    expect(config.gradle).toBeUndefined()
    expect(config.sbt).toBeDefined()
  })
})

describe('coanaSupportsAutoManifestConfig', () => {
  it('supports the minimum version', () => {
    expect(
      coanaSupportsAutoManifestConfig(AUTO_MANIFEST_CONFIG_MIN_COANA_VERSION),
    ).toBe(true)
  })

  it('supports versions newer than the minimum', () => {
    expect(coanaSupportsAutoManifestConfig('15.5.0')).toBe(true)
    expect(coanaSupportsAutoManifestConfig('16.0.0')).toBe(true)
  })

  it('does not support versions older than the minimum', () => {
    expect(coanaSupportsAutoManifestConfig('15.3.26')).toBe(false)
    expect(coanaSupportsAutoManifestConfig('15.4.0')).toBe(false)
    expect(coanaSupportsAutoManifestConfig('14.12.222')).toBe(false)
  })

  it('treats unparseable or missing versions as supported (no second-guessing overrides)', () => {
    expect(coanaSupportsAutoManifestConfig(undefined)).toBe(true)
    expect(coanaSupportsAutoManifestConfig('')).toBe(true)
    expect(coanaSupportsAutoManifestConfig('main')).toBe(true)
  })
})

describe('isAutoManifestConfigEmpty', () => {
  it('is true when there are no ecosystems and the run mode is default', () => {
    expect(isAutoManifestConfigEmpty({})).toBe(true)
  })

  it('is false when failOnBuildToolError is set (fail-closed must reach Coana)', () => {
    expect(isAutoManifestConfigEmpty({ failOnBuildToolError: true })).toBe(
      false,
    )
  })

  it('is false when an ecosystem is configured', () => {
    expect(isAutoManifestConfigEmpty({ gradle: { bin: './gradlew' } })).toBe(
      false,
    )
  })
})
