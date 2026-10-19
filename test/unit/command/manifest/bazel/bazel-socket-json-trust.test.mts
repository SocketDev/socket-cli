import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveBazelManifestSettings } from '../../../../../src/command/manifest/bazel/bazel-socket-json-trust.mts'

import type { BazelManifestCliSettings } from '../../../../../src/command/manifest/bazel/bazel-socket-json-trust.mts'
import type { SocketJson } from '../../../../../src/util/socket/json.mts'

const CWD = path.join(path.sep, 'proj')

const NO_CLI: BazelManifestCliSettings = {
  bazel: undefined,
  bazelFlags: undefined,
  bazelOutputBase: undefined,
  bazelRc: undefined,
  out: undefined,
}

function socketJsonWithBazel(bazel: Record<string, unknown>): SocketJson {
  return { defaults: { manifest: { bazel } } } as unknown as SocketJson
}

describe('resolveBazelManifestSettings', () => {
  it('uses PATH lookup and the default out dir with no socket.json', () => {
    const result = resolveBazelManifestSettings({
      cli: NO_CLI,
      cwd: CWD,
      socketJson: undefined,
      trustSocketJson: false,
    })
    expect(result).toEqual({
      ok: true,
      data: {
        bazel: undefined,
        bazelFlags: '',
        bazelOutputBase: undefined,
        bazelRc: undefined,
        out: path.join(CWD, '.socket', 'bazel-manifests'),
        socketJsonDefaults: [],
      },
    })
  })

  it.each([
    ['bin', 'defaults.manifest.bazel.bin', '/repo/payload.sh'],
    ['bazel', 'defaults.manifest.bazel.bazel', '/repo/payload.sh'],
    ['bazelFlags', 'defaults.manifest.bazel.bazelFlags', '--config=remote'],
    ['bazelRc', 'defaults.manifest.bazel.bazelRc', 'tools/extra.bazelrc'],
    ['bazelOutputBase', 'defaults.manifest.bazel.bazelOutputBase', '/cache'],
  ])('refuses socket.json %s without the trust flag', (key, field, value) => {
    const result = resolveBazelManifestSettings({
      cli: NO_CLI,
      cwd: CWD,
      socketJson: socketJsonWithBazel({ [key]: value }),
      trustSocketJson: false,
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.cause).toContain(field)
  })

  it('honors socket.json execution settings under the trust flag', () => {
    const result = resolveBazelManifestSettings({
      cli: NO_CLI,
      cwd: CWD,
      socketJson: socketJsonWithBazel({
        bazelFlags: '--config=remote',
        bazelOutputBase: '/cache',
        bazelRc: 'tools/extra.bazelrc',
        bin: '/opt/bazelisk',
      }),
      trustSocketJson: true,
    })
    expect(result.ok && result.data).toMatchObject({
      bazel: '/opt/bazelisk',
      bazelFlags: '--config=remote',
      bazelOutputBase: '/cache',
      bazelRc: 'tools/extra.bazelrc',
    })
    expect(result.ok && result.data.socketJsonDefaults).toHaveLength(4)
  })

  it('lets command-line flags override socket.json without the trust flag', () => {
    const result = resolveBazelManifestSettings({
      cli: {
        bazel: '/cli/bazelisk',
        bazelFlags: '--keep_going',
        bazelOutputBase: '/cli-cache',
        bazelRc: 'cli.bazelrc',
        out: '/cli-out',
      },
      cwd: CWD,
      socketJson: socketJsonWithBazel({
        bazelFlags: '--config=remote',
        bazelOutputBase: '/cache',
        bazelRc: 'tools/extra.bazelrc',
        bin: '/repo/payload.sh',
        out: '/elsewhere',
      }),
      trustSocketJson: false,
    })
    expect(result).toEqual({
      ok: true,
      data: {
        bazel: '/cli/bazelisk',
        bazelFlags: '--keep_going',
        bazelOutputBase: '/cli-cache',
        bazelRc: 'cli.bazelrc',
        out: '/cli-out',
        socketJsonDefaults: [],
      },
    })
  })

  it('honors a socket.json out inside the project untrusted', () => {
    const result = resolveBazelManifestSettings({
      cli: NO_CLI,
      cwd: CWD,
      socketJson: socketJsonWithBazel({ out: 'build/manifests' }),
      trustSocketJson: false,
    })
    expect(result.ok && result.data.out).toBe(
      path.join(CWD, 'build', 'manifests'),
    )
  })

  it.each(['../outside', '/etc/socket'])(
    'refuses a socket.json out of %s outside the project',
    out => {
      const result = resolveBazelManifestSettings({
        cli: NO_CLI,
        cwd: CWD,
        socketJson: socketJsonWithBazel({ out }),
        trustSocketJson: false,
      })
      expect(result.ok).toBe(false)
      expect(result.ok ? '' : result.cause).toContain(
        'defaults.manifest.bazel.out',
      )
    },
  )

  it('honors a socket.json out outside the project under the trust flag', () => {
    const result = resolveBazelManifestSettings({
      cli: NO_CLI,
      cwd: CWD,
      socketJson: socketJsonWithBazel({ out: '../outside' }),
      trustSocketJson: true,
    })
    expect(result.ok && result.data.out).toBe(path.resolve(CWD, '../outside'))
  })
})
