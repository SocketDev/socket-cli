/**
 * Trust boundary between the CLI and a scanned repository's socket.json.
 *
 * A repository under scan ships its own socket.json, so every value read from
 * that file is untrusted input. Three fields reach a dangerous sink:
 * `defaults.manifest.<tool>.bin` picks an executable, `gradleOpts`/`sbtOpts`
 * become argv on the same spawn, and `defaults.manifest.conda.infile`/`outfile`
 * are a read and a write destination.
 *
 * The rule: only a command-line flag chooses a build binary, its extra options,
 * or a path outside the project. socket.json is honored when it names the exact
 * binary the CLI would have picked on its own (`<cwd>/gradlew`, `sbt` on PATH)
 * and when its paths stay inside cwd; anything else needs an explicit
 * `--trust-socket-json`.
 */

import { realpathSync } from 'node:fs'
import path from 'node:path'

import { FLAG_JSON } from '../../constants/cli.mjs'
import { ENVIRONMENT_YML, REQUIREMENTS_TXT } from '../../constants/paths.mjs'
import { SOCKET_JSON } from '../../constants/socket.mts'
import { isPathWithinRoot } from '../../util/trusted-executable.mts'

import type { CResult } from '../../types.mts'
import type { SocketJson } from '../../util/socket/json.mts'

export const TRUST_SOCKET_JSON_FLAG = '--trust-socket-json'

/**
 * Canonicalize an absolute path for a containment test, tolerating a target
 * that does not exist yet.
 *
 * `isPathWithinRoot` requires realpathed arguments: `path.resolve` collapses
 * `..` lexically but follows no symlink, so `<cwd>/link/passwd` where `link`
 * points at `/etc` reads as inside the project while the read lands outside
 * it. A write target legitimately may not exist, so canonicalize the deepest
 * existing ancestor and re-append the rest.
 */
export function canonicalizeForContainment(target: string): string {
  let existing = target
  const trailing = []
  // The loop terminates: each step removes a segment, and the filesystem root
  // is its own parent, which realpathSync always resolves.
  for (;;) {
    try {
      return path.join(realpathSync(existing), ...trailing.toReversed())
    } catch {
      const parent = path.dirname(existing)
      if (parent === existing) {
        return target
      }
      trailing.push(path.basename(existing))
      existing = parent
    }
  }
}

/**
 * Read a bin path out of untrusted input. socket.json is parsed JSON and a
 * meow value-taking flag can arrive as a boolean, so both sources can hand us
 * a non-string.
 */
export function readBuildToolBin(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
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
}): CResult<never> {
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
}): CResult<never> {
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
 * Refusal for a socket.json path that resolves outside the project.
 */
export function refuseSocketJsonPath({
  cwd,
  field,
  flag,
  raw,
  reason,
  resolved,
  role,
}: {
  cwd: string
  field: string
  flag: string
  raw: string
  reason: string
  resolved: string
  role: string
}): CResult<never> {
  return {
    ok: false,
    message: `Refused a conda ${role} path chosen by ${SOCKET_JSON}`,
    cause: [
      `${SOCKET_JSON} in ${cwd} sets ${field}.`,
      `Saw \`${raw}\` (resolves to ${resolved}), wanted a path inside ${cwd}.`,
      reason,
      `Fix: pass \`${flag}=${raw}\` on the command line if you trust it, or re-run with \`${TRUST_SOCKET_JSON_FLAG}\` to honor ${SOCKET_JSON} in this checkout.`,
    ].join('\n'),
  }
}

/**
 * Decide which conda input file a run may read. The `-` sentinel means stdin
 * and passes through untouched.
 */
export function resolveCondaInfile({
  cliFile,
  cwd,
  socketJson,
  trustSocketJson,
}: {
  cliFile: unknown
  cwd: string
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
}): CResult<string> {
  const cliFilePath = readBuildToolBin(cliFile)
  if (cliFilePath) {
    return { ok: true, data: cliFilePath }
  }

  const socketJsonFile = readBuildToolBin(
    socketJson?.defaults?.manifest?.conda?.infile,
  )
  if (!socketJsonFile) {
    return { ok: true, data: ENVIRONMENT_YML }
  }
  if (socketJsonFile === '-') {
    return { ok: true, data: socketJsonFile }
  }

  const resolved = path.resolve(cwd, socketJsonFile)
  if (
    !trustSocketJson &&
    !isPathWithinRoot(
      canonicalizeForContainment(cwd),
      canonicalizeForContainment(resolved),
    )
  ) {
    return refuseSocketJsonPath({
      cwd,
      field: 'defaults.manifest.conda.infile',
      flag: '--file',
      raw: socketJsonFile,
      reason: `The CLI reads that file and, with ${FLAG_JSON}, serializes its contents into output a scan uploads, so a scanned repository must not aim the read outside its own tree.`,
      resolved,
      role: 'input',
    })
  }
  return { ok: true, data: resolved }
}

/**
 * Decide which conda output file a run may write. The `-` sentinel means stdout
 * and passes through untouched.
 */
export function resolveCondaOutfile({
  cliOut,
  cwd,
  socketJson,
  trustSocketJson,
}: {
  cliOut: unknown
  cwd: string
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
}): CResult<string> {
  const cliOutPath = readBuildToolBin(cliOut)
  if (cliOutPath) {
    return { ok: true, data: cliOutPath }
  }

  const socketJsonOut = readBuildToolBin(
    socketJson?.defaults?.manifest?.conda?.outfile,
  )
  if (!socketJsonOut) {
    return { ok: true, data: REQUIREMENTS_TXT }
  }
  if (socketJsonOut === '-') {
    return { ok: true, data: socketJsonOut }
  }

  const resolved = path.resolve(cwd, socketJsonOut)
  if (
    !trustSocketJson &&
    !isPathWithinRoot(
      canonicalizeForContainment(cwd),
      canonicalizeForContainment(resolved),
    )
  ) {
    return refuseSocketJsonPath({
      cwd,
      field: 'defaults.manifest.conda.outfile',
      flag: '--out',
      raw: socketJsonOut,
      reason: `The CLI writes the converted requirements there and the content is the pip block harvested from the repository's own ${ENVIRONMENT_YML}, so a path outside the project would let a scanned repository write its own text anywhere the CLI can reach.`,
      resolved,
      role: 'output',
    })
  }
  return { ok: true, data: resolved }
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
  cliBin: unknown
  cliOpts: unknown
  cwd: string
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
}): CResult<BuildToolInvocation> {
  const wrapperBin = path.join(cwd, 'gradlew')
  const cliBinPath = readBuildToolBin(cliBin)
  const socketJsonBin = readBuildToolBin(
    socketJson?.defaults?.manifest?.gradle?.bin,
  )
  const socketJsonOpts = socketJson?.defaults?.manifest?.gradle?.gradleOpts

  let bin = wrapperBin
  if (cliBinPath) {
    bin = path.resolve(cwd, cliBinPath)
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
        saw: splitBuildToolOpts(socketJsonOpts).join(' '),
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
  cliBin: unknown
  cliOpts: unknown
  cwd: string
  socketJson: SocketJson | undefined
  trustSocketJson: boolean
}): CResult<BuildToolInvocation> {
  // `sbt` is installed system-wide, so the conventional invocation is the bare
  // name resolved against PATH rather than a project-local wrapper.
  const pathBin = 'sbt'
  const cliBinPath = readBuildToolBin(cliBin)
  const socketJsonBin = readBuildToolBin(
    socketJson?.defaults?.manifest?.sbt?.bin,
  )
  const socketJsonOpts = socketJson?.defaults?.manifest?.sbt?.sbtOpts

  let bin = pathBin
  if (cliBinPath) {
    bin = cliBinPath
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
        saw: splitBuildToolOpts(socketJsonOpts).join(' '),
        tool: 'sbt',
      })
    }
    opts = splitBuildToolOpts(socketJsonOpts)
  }

  return { ok: true, data: { bin, opts } }
}

export interface BuildToolInvocation {
  bin: string
  opts: string[]
}

/**
 * Split a space-separated option string into argv tokens. A value-taking flag
 * whose value meow could not capture (`--gradle-opts --info`) arrives as a
 * boolean, so anything that is not a string yields no tokens.
 */
export function splitBuildToolOpts(raw: unknown): string[] {
  if (typeof raw !== 'string') {
    return []
  }
  return raw
    .split(' ')
    .map(s => s.trim())
    .filter(Boolean)
}
