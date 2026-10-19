/**
 * Socket.json settings that pick what `socket manifest bazel` runs, or where
 * it writes outside the project, need `--trust-socket-json`.
 */
import path from 'node:path'

import { SOCKET_JSON } from '../../../constants/socket.mts'
import { isPathWithinRoot } from '../../../util/trusted-executable.mts'
import {
  canonicalizeForContainment,
  readBuildToolBin,
  TRUST_SOCKET_JSON_FLAG,
} from '../manifest-build-trust.mts'

import type { CResult } from '../../../types.mts'
import type { SocketJson } from '../../../util/socket/json.mts'

export type BazelSocketJsonConfig = NonNullable<
  NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['bazel']
>

export type BazelManifestCliSettings = {
  bazel: unknown
  bazelFlags: unknown
  bazelOutputBase: unknown
  bazelRc: unknown
  out: unknown
}

export type BazelManifestSettings = {
  bazel: string | undefined
  bazelFlags: string
  bazelOutputBase: string | undefined
  bazelRc: string | undefined
  out: string
  socketJsonDefaults: Array<{ flag: string; value: string }>
}

export type BazelManifestSettingTally = {
  refusedFields: string[]
  socketJsonDefaults: BazelManifestSettings['socketJsonDefaults']
  trustSocketJson: boolean
}

/**
 * A command-line value always wins. A socket.json value is recorded as refused
 * unless the trust flag is set.
 */
export function readBazelManifestSetting(
  tally: BazelManifestSettingTally,
  {
    cliValue,
    field,
    flag,
    socketJsonValue,
  }: {
    cliValue: unknown
    field: string
    flag: string
    socketJsonValue: unknown
  },
): string | undefined {
  const fromCli = readBuildToolBin(cliValue)
  if (fromCli) {
    return fromCli
  }
  const fromSocketJson = readBuildToolBin(socketJsonValue)
  if (!fromSocketJson) {
    return undefined
  }
  if (!tally.trustSocketJson) {
    tally.refusedFields.push(field)
    return undefined
  }
  tally.socketJsonDefaults.push({ flag, value: fromSocketJson })
  return fromSocketJson
}

export function resolveBazelManifestOut({
  cliOut,
  cwd,
  socketJson,
  trustSocketJson,
}: {
  cliOut: unknown
  cwd: string
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
}): CResult<{ fromSocketJson: boolean; path: string }> {
  const fromCli = readBuildToolBin(cliOut)
  if (fromCli) {
    return { ok: true, data: { fromSocketJson: false, path: fromCli } }
  }
  const socketJsonOut = readBuildToolBin(
    socketJson?.defaults?.manifest?.bazel?.out,
  )
  if (!socketJsonOut) {
    return {
      ok: true,
      data: {
        fromSocketJson: false,
        path: path.join(cwd, '.socket', 'bazel-manifests'),
      },
    }
  }
  const resolvedOut = path.resolve(cwd, socketJsonOut)
  if (
    !trustSocketJson &&
    !isPathWithinRoot(
      canonicalizeForContainment(cwd),
      canonicalizeForContainment(resolvedOut),
    )
  ) {
    return {
      ok: false,
      message: `Refused a bazel output path chosen by ${SOCKET_JSON}`,
      cause: [
        `${SOCKET_JSON} in ${cwd} sets defaults.manifest.bazel.out.`,
        `Saw \`${socketJsonOut}\` (resolves to ${resolvedOut}), wanted a path inside ${cwd}.`,
        'The CLI writes generated manifests there, so a path outside the project would let a scanned repository choose where the CLI writes.',
        `Fix: pass \`--out=${socketJsonOut}\` on the command line if you trust it, or re-run with ${TRUST_SOCKET_JSON_FLAG} to honor ${SOCKET_JSON} in this checkout.`,
      ].join('\n'),
    }
  }
  return { ok: true, data: { fromSocketJson: true, path: resolvedOut } }
}

export function resolveBazelManifestSettings({
  cli,
  cwd,
  socketJson,
  trustSocketJson,
}: {
  cli: BazelManifestCliSettings
  cwd: string
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
}): CResult<BazelManifestSettings> {
  const bazelConfig: BazelSocketJsonConfig =
    socketJson?.defaults?.manifest?.bazel ?? {}
  const tally: BazelManifestSettingTally = {
    refusedFields: [],
    socketJsonDefaults: [],
    trustSocketJson,
  }

  const bazel = readBazelManifestSetting(tally, {
    cliValue: cli.bazel,
    field: bazelConfig.bazel
      ? 'defaults.manifest.bazel.bazel'
      : 'defaults.manifest.bazel.bin',
    flag: '--bazel',
    socketJsonValue: bazelConfig.bazel ?? bazelConfig.bin,
  })
  const bazelFlags = readBazelManifestSetting(tally, {
    cliValue: cli.bazelFlags,
    field: 'defaults.manifest.bazel.bazelFlags',
    flag: '--bazel-flags',
    socketJsonValue: bazelConfig.bazelFlags,
  })
  const bazelRc = readBazelManifestSetting(tally, {
    cliValue: cli.bazelRc,
    field: 'defaults.manifest.bazel.bazelRc',
    flag: '--bazel-rc',
    socketJsonValue: bazelConfig.bazelRc,
  })
  const bazelOutputBase = readBazelManifestSetting(tally, {
    cliValue: cli.bazelOutputBase,
    field: 'defaults.manifest.bazel.bazelOutputBase',
    flag: '--bazel-output-base',
    socketJsonValue: bazelConfig.bazelOutputBase,
  })

  if (tally.refusedFields.length) {
    return {
      ok: false,
      message: `Refused bazel settings chosen by ${SOCKET_JSON}`,
      cause: [
        `${SOCKET_JSON} in ${cwd} sets ${tally.refusedFields.join(', ')}.`,
        'Saw repository-supplied bazel execution settings, wanted none.',
        'These values pick the bazel binary and the options it runs with, and a scanned repository controls its own socket.json.',
        `Fix: pass --bazel, --bazel-flags, --bazel-rc, or --bazel-output-base on the command line, or re-run with ${TRUST_SOCKET_JSON_FLAG} to honor ${SOCKET_JSON} in this checkout.`,
      ].join('\n'),
    }
  }

  const out = resolveBazelManifestOut({
    cliOut: cli.out,
    cwd,
    socketJson,
    trustSocketJson,
  })
  if (!out.ok) {
    return out
  }
  if (out.data.fromSocketJson) {
    tally.socketJsonDefaults.push({ flag: '--out', value: out.data.path })
  }

  return {
    ok: true,
    data: {
      bazel,
      bazelFlags: bazelFlags ?? '',
      bazelOutputBase,
      bazelRc,
      out: out.data.path,
      socketJsonDefaults: tally.socketJsonDefaults,
    },
  }
}
