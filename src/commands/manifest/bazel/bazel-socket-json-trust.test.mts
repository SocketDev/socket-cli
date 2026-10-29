import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveBazelManifestSettings } from './bazel-socket-json-trust.mts'
import { getDefaultSocketJson } from '../../../utils/socket-json.mts'

function resolve(
  config: Record<string, string> = {},
  cli: Record<string, string> = {},
  trustSocketJson = false,
) {
  const socketJson = getDefaultSocketJson()
  socketJson.defaults = { manifest: { bazel: config } }
  return resolveBazelManifestSettings({
    cli: {
      bazel: cli.bazel,
      bazelFlags: cli.bazelFlags,
      bazelOutputBase: cli.bazelOutputBase,
      bazelRc: cli.bazelRc,
      out: cli.out,
    },
    cwd: '/repo',
    socketJson,
    trustSocketJson,
  })
}

describe('resolveBazelManifestSettings', () => {
  it('uses safe defaults when socket.json has no Bazel settings', () => {
    expect(resolve()).toMatchObject({
      ok: true,
      data: {
        bazel: undefined,
        bazelFlags: '',
        out: '/repo/.socket/bazel-manifests',
        socketJsonDefaults: [],
      },
    })
  })

  it('refuses repository-selected executable and arguments by default', () => {
    const result = resolve({
      bazel: './tools/bazel',
      bazelFlags: '--host_jvm_args=x',
    })
    expect(result).toMatchObject({
      ok: false,
      message: 'Refused bazel settings chosen by socket.json',
    })
    if (!result.ok) {
      expect(result.cause).toContain('--bazel, --bazel-flags')
      expect(result.cause).toContain('--trust-socket-json')
    }
  })

  it('lets explicit CLI values override socket.json settings', () => {
    expect(
      resolve(
        { bazel: './repo-bazel', bazelFlags: '--bad' },
        { bazel: '/usr/bin/bazel', bazelFlags: '--good' },
      ),
    ).toMatchObject({
      ok: true,
      data: {
        bazel: '/usr/bin/bazel',
        bazelFlags: '--good',
        socketJsonDefaults: [],
      },
    })
  })

  it('uses repository settings only after explicit trust', () => {
    expect(
      resolve({ bazel: './tools/bazel', bazelFlags: '--config=ci' }, {}, true),
    ).toMatchObject({
      ok: true,
      data: {
        bazel: './tools/bazel',
        bazelFlags: '--config=ci',
        socketJsonDefaults: [
          { flag: '--bazel', value: './tools/bazel' },
          { flag: '--bazel-flags', value: '--config=ci' },
        ],
      },
    })
  })

  it('refuses output paths outside the project unless trusted or overridden', () => {
    expect(resolve({ out: '../outside' })).toMatchObject({
      ok: false,
      message: 'Refused a bazel output path chosen by socket.json',
    })
    expect(resolve({ out: '../outside' }, { out: 'inside' })).toMatchObject({
      ok: true,
      data: { out: '/repo/inside' },
    })
    expect(resolve({ out: '../outside' }, {}, true)).toMatchObject({
      ok: true,
      data: { out: '/outside' },
    })
  })

  it('allows an in-project socket.json output path without trust', () => {
    expect(resolve({ out: '.cache/manifests' })).toMatchObject({
      ok: true,
      data: { out: '/repo/.cache/manifests' },
    })
  })

  it.skipIf(process.platform === 'win32')(
    'refuses an in-project output path that escapes through a symlink',
    () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'socket-bazel-trust-'))
      const cwd = path.join(root, 'repo')
      const outside = path.join(root, 'outside')
      mkdirSync(cwd)
      mkdirSync(outside)
      symlinkSync(outside, path.join(cwd, 'generated'))
      try {
        const socketJson = getDefaultSocketJson()
        socketJson.defaults = { manifest: { bazel: { out: 'generated/out' } } }
        expect(
          resolveBazelManifestSettings({
            cli: {
              bazel: undefined,
              bazelFlags: undefined,
              bazelOutputBase: undefined,
              bazelRc: undefined,
              out: undefined,
            },
            cwd,
            socketJson,
            trustSocketJson: false,
          }),
        ).toMatchObject({
          ok: false,
          message: 'Refused a bazel output path chosen by socket.json',
        })
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    },
  )
})
