/**
 * Trust boundary between the CLI and a scanned repository's socket.json.
 *
 * A repository under scan ships its own socket.json, so every value read from
 * that file is untrusted input. Gradle and sbt invocations are the sharpest
 * edge: `defaults.manifest.<tool>.bin` picks the executable and
 * `gradleOpts`/`sbtOpts` become argv on the same spawn.
 *
 * The rule: only a command-line flag chooses a build binary or its extra
 * options. socket.json is honored when it names the exact binary the CLI would
 * have picked on its own (`<cwd>/gradlew`, `sbt` on PATH) and otherwise needs
 * an explicit `--trust-socket-json`.
 */

import path from 'node:path'

import { SOCKET_JSON } from '../../constants/socket.mts'

import type { CResult } from '../../types.mts'
import type { SocketJson } from '../../util/socket/json.mts'

export const TRUST_SOCKET_JSON_FLAG = '--trust-socket-json'

export interface BuildToolInvocation {
  bin: string
  opts: string[]
}

/**
 * Split a space-separated option string into argv tokens.
 */
export function splitBuildToolOpts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(' ')
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Refusal for a socket.json `bin` that points somewhere other than the
 * conventional wrapper.
 */
export function refuseSocketJsonBin({
  cwd,
  field,
  flag,
  saw,
  tool,
  wanted,
}: {
  cwd: string
  field: string
  flag: string
  saw: string
  tool: string
  wanted: string
}): CResult<BuildToolInvocation> {
  return {
    ok: false,
    message: `Refused a ${tool} binary chosen by ${SOCKET_JSON}`,
    cause: [
      `${SOCKET_JSON} in ${cwd} sets ${field}.`,
      `Saw \`${saw}\`, wanted ${wanted}.`,
      `A scanned repository controls its own ${SOCKET_JSON}, so the CLI will not execute a binary that file names.`,
      `Fix: pass \`${flag}=${saw}\` on the command line if you trust it, or re-run with \`${TRUST_SOCKET_JSON_FLAG}\` to honor ${SOCKET_JSON} in this checkout.`,
    ].join('\n'),
  }
}

/**
 * Refusal for socket.json-supplied extra options.
 */
export function refuseSocketJsonOpts({
  cwd,
  field,
  flag,
  reason,
  saw,
  tool,
}: {
  cwd: string
  field: string
  flag: string
  reason: string
  saw: string
  tool: string
}): CResult<BuildToolInvocation> {
  return {
    ok: false,
    message: `Refused ${tool} options chosen by ${SOCKET_JSON}`,
    cause: [
      `${SOCKET_JSON} in ${cwd} sets ${field}.`,
      `Saw \`${saw}\`, wanted no repository-supplied options.`,
      `${reason} There is no subset the CLI can safely accept from a file the scanned repository controls, so all of them are refused.`,
      `Fix: pass \`${flag}="${saw}"\` on the command line if you trust it, or re-run with \`${TRUST_SOCKET_JSON_FLAG}\` to honor ${SOCKET_JSON} in this checkout.`,
    ].join('\n'),
  }
}

/**
 * Decide which gradle binary and options a run may use.
 */
export function resolveGradleInvocation({
  cliBin,
  cliOpts,
  cwd,
  socketJson,
  trustSocketJson,
}: {
  cliBin: string | undefined
  cliOpts: string | undefined
  cwd: string
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
}): CResult<BuildToolInvocation> {
  const wrapperBin = path.join(cwd, 'gradlew')
  const socketJsonBin = socketJson?.defaults?.manifest?.gradle?.bin
  const socketJsonOpts = socketJson?.defaults?.manifest?.gradle?.gradleOpts

  let bin = wrapperBin
  if (cliBin) {
    bin = path.resolve(cwd, cliBin)
  } else if (socketJsonBin) {
    const resolved = path.resolve(cwd, socketJsonBin)
    if (!trustSocketJson && resolved !== wrapperBin) {
      return refuseSocketJsonBin({
        cwd,
        field: 'defaults.manifest.gradle.bin',
        flag: '--bin',
        saw: socketJsonBin,
        tool: 'gradle',
        wanted: `the project wrapper \`${wrapperBin}\``,
      })
    }
    bin = resolved
  }

  let opts: string[] = []
  if (cliOpts) {
    opts = splitBuildToolOpts(cliOpts)
  } else if (splitBuildToolOpts(socketJsonOpts).length) {
    if (!trustSocketJson) {
      return refuseSocketJsonOpts({
        cwd,
        field: 'defaults.manifest.gradle.gradleOpts',
        flag: '--gradle-opts',
        reason:
          'Gradle options redirect execution: `-I`/`--init-script` and `--include-build` load arbitrary build logic, `-g`/`--gradle-user-home` points at an `init.d` directory Gradle runs on startup, and `-D org.gradle.java.home` / `-D org.gradle.jvmargs` choose the JVM and its agents.',
        saw: socketJsonOpts ?? '',
        tool: 'gradle',
      })
    }
    opts = splitBuildToolOpts(socketJsonOpts)
  }

  return { ok: true, data: { bin, opts } }
}

/**
 * Decide which sbt binary and options a run may use.
 */
export function resolveSbtInvocation({
  cliBin,
  cliOpts,
  cwd,
  socketJson,
  trustSocketJson,
}: {
  cliBin: string | undefined
  cliOpts: string | undefined
  cwd: string
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
}): CResult<BuildToolInvocation> {
  // `sbt` is installed system-wide, so the conventional invocation is the bare
  // name resolved against PATH rather than a project-local wrapper.
  const pathBin = 'sbt'
  const socketJsonBin = socketJson?.defaults?.manifest?.sbt?.bin
  const socketJsonOpts = socketJson?.defaults?.manifest?.sbt?.sbtOpts

  let bin = pathBin
  if (cliBin) {
    bin = cliBin
  } else if (socketJsonBin) {
    if (!trustSocketJson && socketJsonBin !== pathBin) {
      return refuseSocketJsonBin({
        cwd,
        field: 'defaults.manifest.sbt.bin',
        flag: '--bin',
        saw: socketJsonBin,
        tool: 'sbt',
        wanted: `the \`${pathBin}\` on your PATH`,
      })
    }
    bin = socketJsonBin
  }

  let opts: string[] = []
  if (cliOpts) {
    opts = splitBuildToolOpts(cliOpts)
  } else if (splitBuildToolOpts(socketJsonOpts).length) {
    if (!trustSocketJson) {
      return refuseSocketJsonOpts({
        cwd,
        field: 'defaults.manifest.sbt.sbtOpts',
        flag: '--sbt-opts',
        reason:
          'sbt options redirect execution: `-J` passes JVM arguments straight through, `-D sbt.global.base` / `-D sbt.boot.directory` relocate the plugin and launcher directories sbt loads, and a bare argument is an sbt command such as `eval`, which evaluates Scala.',
        saw: socketJsonOpts ?? '',
        tool: 'sbt',
      })
    }
    opts = splitBuildToolOpts(socketJsonOpts)
  }

  return { ok: true, data: { bin, opts } }
}
