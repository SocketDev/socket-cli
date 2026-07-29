/**
 * Unit tests for the socket.json build-tool trust boundary.
 *
 * A scanned repository owns its socket.json, so `defaults.manifest.<tool>.bin`
 * and `gradleOpts`/`sbtOpts` are untrusted input. These tests pin the rule:
 * the conventional wrapper still runs with no friction, a redirected bin or any
 * repo-supplied option is refused, and an explicit CLI flag is honored.
 *
 * Related Files:
 *
 * - Src/commands/manifest/manifest-build-trust.mts
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  readBuildToolBin,
  resolveGradleInvocation,
  resolveSbtInvocation,
  splitBuildToolOpts,
} from '../../../../src/commands/manifest/manifest-build-trust.mts'

import type { SocketJson } from '../../../../src/util/socket/json.mts'

const CWD = path.join(path.sep, 'proj')
const GRADLEW = path.join(CWD, 'gradlew')

function socketJsonWithGradle(
  gradle: Record<string, unknown>,
): SocketJson | undefined {
  return { defaults: { manifest: { gradle } } } as unknown as SocketJson
}

function socketJsonWithSbt(
  sbt: Record<string, unknown>,
): SocketJson | undefined {
  return { defaults: { manifest: { sbt } } } as unknown as SocketJson
}

describe('splitBuildToolOpts', () => {
  it('splits a space-separated string and drops empties', () => {
    expect(splitBuildToolOpts('  --info   --stacktrace ')).toEqual([
      '--info',
      '--stacktrace',
    ])
  })

  it('yields no tokens for a non-string', () => {
    expect(splitBuildToolOpts(true)).toEqual([])
    expect(splitBuildToolOpts(undefined)).toEqual([])
  })
})

describe('readBuildToolBin', () => {
  it('trims a string and rejects everything else', () => {
    expect(readBuildToolBin('  ./gradlew ')).toBe('./gradlew')
    expect(readBuildToolBin({ toString: () => 'evil' })).toBe('')
    expect(readBuildToolBin(undefined)).toBe('')
  })
})

describe('resolveGradleInvocation', () => {
  it('defaults to the project wrapper with no socket.json', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: undefined,
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toEqual({ bin: GRADLEW, opts: [] })
  })

  it('honors a socket.json bin that names the wrapper the CLI would pick', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: './gradlew' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe(GRADLEW)
  })

  it('refuses a socket.json bin that points elsewhere', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: './.ci/gradlew' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Refused a gradle binary')
    expect(!result.ok && result.cause).toContain('defaults.manifest.gradle.bin')
    expect(!result.ok && result.cause).toContain('--trust-socket-json')
  })

  it('refuses a bare socket.json bin that would hit PATH', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: 'gradle' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
  })

  it('honors a redirected socket.json bin under --trust-socket-json', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: './.ci/gradlew' }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe(path.join(CWD, '.ci', 'gradlew'))
  })

  it('honors an explicit CLI bin over a socket.json bin', () => {
    const result = resolveGradleInvocation({
      cliBin: '/usr/local/bin/gradle',
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: './evil' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe(
      path.resolve(CWD, '/usr/local/bin/gradle'),
    )
  })

  it('refuses an execution-redirecting socket.json gradleOpts', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({
        gradleOpts: '--init-script ./payload.gradle',
      }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Refused gradle options')
    expect(!result.ok && result.cause).toContain(
      'defaults.manifest.gradle.gradleOpts',
    )
  })

  it('refuses a benign-looking socket.json gradleOpts too', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ gradleOpts: '--info' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
  })

  it('honors socket.json gradleOpts under --trust-socket-json', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ gradleOpts: '--info --stacktrace' }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.opts).toEqual(['--info', '--stacktrace'])
  })

  it('honors explicit CLI opts over socket.json opts', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: '--offline',
      cwd: CWD,
      socketJson: socketJsonWithGradle({
        gradleOpts: '--init-script ./payload.gradle',
      }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.opts).toEqual(['--offline'])
  })

  it('ignores a non-string socket.json bin instead of throwing', () => {
    const result = resolveGradleInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithGradle({ bin: { toString: () => 'evil' } }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe(GRADLEW)
  })
})

describe('resolveSbtInvocation', () => {
  it('defaults to the sbt on PATH with no socket.json', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: undefined,
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toEqual({ bin: 'sbt', opts: [] })
  })

  it('honors a socket.json bin that names the conventional sbt', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ bin: 'sbt' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe('sbt')
  })

  it('refuses a socket.json bin that points into the repo', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ bin: './sbt' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Refused a sbt binary')
    expect(!result.ok && result.cause).toContain('defaults.manifest.sbt.bin')
  })

  it('honors a redirected socket.json bin under --trust-socket-json', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ bin: './sbt' }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe('./sbt')
  })

  it('honors an explicit CLI bin over a socket.json bin', () => {
    const result = resolveSbtInvocation({
      cliBin: '/usr/bin/sbt',
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ bin: './sbt' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.bin).toBe('/usr/bin/sbt')
  })

  it('refuses socket.json sbtOpts carrying an sbt command', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ sbtOpts: 'eval sys.process.Process' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Refused sbt options')
    expect(!result.ok && result.cause).toContain(
      'defaults.manifest.sbt.sbtOpts',
    )
  })

  it('honors socket.json sbtOpts under --trust-socket-json', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: undefined,
      cwd: CWD,
      socketJson: socketJsonWithSbt({ sbtOpts: '-batch -no-colors' }),
      trustSocketJson: true,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.opts).toEqual(['-batch', '-no-colors'])
  })

  it('honors explicit CLI opts over socket.json opts', () => {
    const result = resolveSbtInvocation({
      cliBin: undefined,
      cliOpts: '-batch',
      cwd: CWD,
      socketJson: socketJsonWithSbt({ sbtOpts: 'eval 1' }),
      trustSocketJson: false,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.opts).toEqual(['-batch'])
  })
})
