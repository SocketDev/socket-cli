/**
 * Shared replace patterns for Rollup configs.
 * Generates all notation variants for process.env replacements.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { spawnSync } from '@socketsecurity/registry/lib/spawn'
import { stripAnsi } from '@socketsecurity/registry/lib/strings'

import { UTF8, VITEST } from '../scripts/constants/build.mjs'
import {
  INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION,
  INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
  INLINED_SOCKET_CLI_HOMEPAGE,
  INLINED_SOCKET_CLI_LEGACY_BUILD,
  INLINED_SOCKET_CLI_NAME,
  INLINED_SOCKET_CLI_PUBLISHED_BUILD,
  INLINED_SOCKET_CLI_PYTHON_BUILD_TAG,
  INLINED_SOCKET_CLI_PYTHON_VERSION,
  INLINED_SOCKET_CLI_SENTRY_BUILD,
  INLINED_SOCKET_CLI_SYNP_VERSION,
  INLINED_SOCKET_CLI_VERSION,
  INLINED_SOCKET_CLI_VERSION_HASH,
} from '../scripts/constants/env.mjs'
import { rootPath } from '../scripts/constants/paths.mjs'

let _rootPkgJson
function getRootPkgJsonSync() {
  if (_rootPkgJson === undefined) {
    const pkgPath = path.join(rootPath, 'package.json')
    _rootPkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  }
  return _rootPkgJson
}

let _socketVersionHash
function getSocketCliVersionHash() {
  if (_socketVersionHash === undefined) {
    const randUuidSegment = randomUUID().split('-')[0]
    const { version } = getRootPkgJsonSync()
    let gitHash = ''
    try {
      gitHash = stripAnsi(
        spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
          encoding: UTF8,
        }).stdout.trim(),
      )
    } catch {}
    // Make each build generate a unique version id, regardless.
    // Mostly for development: confirms the build refreshed. For prod builds
    // the git hash should suffice to identify the build.
    _socketVersionHash = `${version}:${gitHash}:${randUuidSegment}${
      process.env[INLINED_SOCKET_CLI_PUBLISHED_BUILD] ? '' : ':dev'
    }`
  }
  return _socketVersionHash
}

/**
 * Generate replace patterns for all notation variants.
 * Creates patterns for: process.env.NAME, process.env[NAME], process.env['NAME'], process.env["NAME"]
 */
export function generateReplacePatterns() {
  return [
    [
      INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION,
      () =>
        JSON.stringify(
          getRootPkgJsonSync().devDependencies['@coana-tech/cli'],
        ),
    ],
    [
      INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
      () =>
        JSON.stringify(
          getRootPkgJsonSync().devDependencies['@cyclonedx/cdxgen'],
        ),
    ],
    [INLINED_SOCKET_CLI_PYTHON_VERSION, () => JSON.stringify('3.10.18')],
    [
      INLINED_SOCKET_CLI_PYTHON_BUILD_TAG,
      () => JSON.stringify('20250918'),
    ],
    [
      INLINED_SOCKET_CLI_HOMEPAGE,
      () => JSON.stringify(getRootPkgJsonSync().homepage),
    ],
    [
      INLINED_SOCKET_CLI_LEGACY_BUILD,
      () => JSON.stringify(!!process.env[INLINED_SOCKET_CLI_LEGACY_BUILD]),
    ],
    [
      INLINED_SOCKET_CLI_NAME,
      () => JSON.stringify(getRootPkgJsonSync().name),
    ],
    [
      INLINED_SOCKET_CLI_PUBLISHED_BUILD,
      () =>
        JSON.stringify(!!process.env[INLINED_SOCKET_CLI_PUBLISHED_BUILD]),
    ],
    [
      INLINED_SOCKET_CLI_SENTRY_BUILD,
      () => JSON.stringify(!!process.env[INLINED_SOCKET_CLI_SENTRY_BUILD]),
    ],
    [
      INLINED_SOCKET_CLI_SYNP_VERSION,
      () => JSON.stringify(getRootPkgJsonSync().devDependencies.synp),
    ],
    [
      INLINED_SOCKET_CLI_VERSION,
      () => JSON.stringify(getRootPkgJsonSync().version),
    ],
    [
      INLINED_SOCKET_CLI_VERSION_HASH,
      () => JSON.stringify(getSocketCliVersionHash()),
    ],
    [VITEST, () => !!process.env[VITEST]],
  ].reduce((obj, { 0: name, 1: value }) => {
    obj[`process.env.${name}`] = value
    obj[`process.env[${name}]`] = value
    obj[`process.env['${name}']`] = value
    obj[`process.env["${name}"]`] = value
    return obj
  }, {})
}

/**
 * Generate replace patterns for bracket notation only (for second pass without delimiters).
 */
export function generateBracketReplacePatterns() {
  return [
    [
      INLINED_SOCKET_CLI_COANA_TECH_CLI_VERSION,
      () =>
        JSON.stringify(
          getRootPkgJsonSync().devDependencies['@coana-tech/cli'],
        ),
    ],
    [
      INLINED_SOCKET_CLI_CYCLONEDX_CDXGEN_VERSION,
      () =>
        JSON.stringify(
          getRootPkgJsonSync().devDependencies['@cyclonedx/cdxgen'],
        ),
    ],
    [INLINED_SOCKET_CLI_PYTHON_VERSION, () => JSON.stringify('3.10.18')],
    [
      INLINED_SOCKET_CLI_PYTHON_BUILD_TAG,
      () => JSON.stringify('20250918'),
    ],
    [
      INLINED_SOCKET_CLI_HOMEPAGE,
      () => JSON.stringify(getRootPkgJsonSync().homepage),
    ],
    [
      INLINED_SOCKET_CLI_LEGACY_BUILD,
      () => JSON.stringify(!!process.env[INLINED_SOCKET_CLI_LEGACY_BUILD]),
    ],
    [
      INLINED_SOCKET_CLI_NAME,
      () => JSON.stringify(getRootPkgJsonSync().name),
    ],
    [
      INLINED_SOCKET_CLI_PUBLISHED_BUILD,
      () =>
        JSON.stringify(!!process.env[INLINED_SOCKET_CLI_PUBLISHED_BUILD]),
    ],
    [
      INLINED_SOCKET_CLI_SENTRY_BUILD,
      () => JSON.stringify(!!process.env[INLINED_SOCKET_CLI_SENTRY_BUILD]),
    ],
    [
      INLINED_SOCKET_CLI_SYNP_VERSION,
      () => JSON.stringify(getRootPkgJsonSync().devDependencies.synp),
    ],
    [
      INLINED_SOCKET_CLI_VERSION,
      () => JSON.stringify(getRootPkgJsonSync().version),
    ],
    [
      INLINED_SOCKET_CLI_VERSION_HASH,
      () => JSON.stringify(getSocketCliVersionHash()),
    ],
    [VITEST, () => !!process.env[VITEST]],
  ].reduce((obj, { 0: name, 1: value }) => {
    obj[`process.env['${name}']`] = value
    obj[`process.env["${name}"]`] = value
    return obj
  }, {})
}
