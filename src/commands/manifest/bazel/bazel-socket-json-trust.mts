import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { SOCKET_JSON } from '../../../constants.mts'

import type { SocketJson } from '../../../utils/socket-json.mts'

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

export type BazelManifestSettingsResult =
  | { ok: true; data: BazelManifestSettings }
  | { ok: false; message: string; cause: string }

function canonicalizeForContainment(filePath: string): string {
  let existingPath = path.resolve(filePath)
  const missingSegments: string[] = []
  while (!existsSync(existingPath)) {
    const parent = path.dirname(existingPath)
    if (parent === existingPath) {
      break
    }
    missingSegments.unshift(path.basename(existingPath))
    existingPath = parent
  }
  return path.join(realpathSync(existingPath), ...missingSegments)
}

function readSetting(
  cliValue: unknown,
  socketJsonValue: unknown,
  flag: string,
  trustSocketJson: boolean,
  refusedFields: string[],
  socketJsonDefaults: BazelManifestSettings['socketJsonDefaults'],
): string | undefined {
  if (typeof cliValue === 'string' && cliValue.length > 0) {
    return cliValue
  }
  if (typeof socketJsonValue !== 'string' || socketJsonValue.length === 0) {
    return undefined
  }
  if (!trustSocketJson) {
    refusedFields.push(flag)
    return undefined
  }
  socketJsonDefaults.push({ flag, value: socketJsonValue })
  return socketJsonValue
}

export function resolveBazelManifestSettings({
  cli,
  cwd,
  socketJson,
  trustSocketJson,
}: {
  cli: BazelManifestCliSettings
  cwd: string
  socketJson: SocketJson
  trustSocketJson: boolean
}): BazelManifestSettingsResult {
  const config = socketJson.defaults?.manifest?.bazel ?? {}
  const refusedFields: string[] = []
  const socketJsonDefaults: BazelManifestSettings['socketJsonDefaults'] = []
  const bazel = readSetting(
    cli.bazel,
    config.bazel ?? config.bin,
    '--bazel',
    trustSocketJson,
    refusedFields,
    socketJsonDefaults,
  )
  const bazelFlags = readSetting(
    cli.bazelFlags,
    config.bazelFlags,
    '--bazel-flags',
    trustSocketJson,
    refusedFields,
    socketJsonDefaults,
  )
  const bazelOutputBase = readSetting(
    cli.bazelOutputBase,
    config.bazelOutputBase,
    '--bazel-output-base',
    trustSocketJson,
    refusedFields,
    socketJsonDefaults,
  )
  const bazelRc = readSetting(
    cli.bazelRc,
    config.bazelRc,
    '--bazel-rc',
    trustSocketJson,
    refusedFields,
    socketJsonDefaults,
  )

  if (refusedFields.length > 0) {
    return {
      ok: false,
      message: `Refused bazel settings chosen by ${SOCKET_JSON}`,
      cause: [
        `${SOCKET_JSON} in ${cwd} sets ${refusedFields.join(', ')}.`,
        'Saw repository-supplied bazel execution settings, wanted none.',
        'These values choose the Bazel executable and its options, and the scanned repository controls its own socket.json.',
        'Fix: pass --bazel, --bazel-flags, --bazel-rc, or --bazel-output-base on the command line, or re-run with --trust-socket-json.',
      ].join('\n'),
    }
  }

  const cliOut = typeof cli.out === 'string' ? cli.out : undefined
  const socketJsonOut = config.out
  const outFromSocketJson = !cliOut && typeof socketJsonOut === 'string'
  const outValue = cliOut ?? socketJsonOut
  const resolvedOut = outValue
    ? path.resolve(cwd, outValue)
    : path.join(cwd, '.socket', 'bazel-manifests')
  const canonicalCwd = canonicalizeForContainment(cwd)
  const canonicalOut = canonicalizeForContainment(resolvedOut)
  const relativeOut = path.relative(canonicalCwd, canonicalOut)
  if (
    outFromSocketJson &&
    !trustSocketJson &&
    (relativeOut === '..' ||
      relativeOut.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeOut))
  ) {
    return {
      ok: false,
      message: `Refused a bazel output path chosen by ${SOCKET_JSON}`,
      cause: [
        `${SOCKET_JSON} in ${cwd} sets defaults.manifest.bazel.out.`,
        `Saw \`${socketJsonOut}\` (resolves to ${resolvedOut}), wanted a path inside ${cwd}.`,
        'The CLI writes generated manifests there, so a scanned repository must not choose an output path outside the project.',
        `Fix: pass --out=${socketJsonOut} if you trust this path, or re-run with --trust-socket-json to honor the setting.`,
      ].join('\n'),
    }
  }
  if (outFromSocketJson) {
    socketJsonDefaults.push({ flag: '--out', value: resolvedOut })
  }

  return {
    ok: true,
    data: {
      bazel,
      bazelFlags: bazelFlags ?? '',
      bazelOutputBase,
      bazelRc,
      out: resolvedOut,
      socketJsonDefaults,
    },
  }
}
