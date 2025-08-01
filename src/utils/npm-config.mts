import NpmConfig from '@npmcli/config'
import {
  definitions as npmConfigDefinitions,
  flatten as npmConfigFlatten,
  shorthands as npmConfigShorthands,
  // @ts-ignore: TypeScript types unavailable.
} from '@npmcli/config/lib/definitions'

import { getNpmDirPath } from './npm-paths.mts'

import type { ArboristOptions } from '../shadow/npm/arborist/types.mts'
import type { SemVer } from 'semver'

export type NpmConfigOptions = {
  cwd?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  execPath?: string | undefined
  nodeVersion?: string | undefined
  npmCommand?: string | undefined
  npmPath?: string | undefined
  npmVersion?: SemVer | string | undefined
  platform?: NodeJS.Platform | undefined
}

export async function getNpmConfig(
  options?: NpmConfigOptions | undefined,
): Promise<ArboristOptions> {
  const {
    cwd = process.cwd(),
    env = process.env,
    execPath = process.execPath,
    nodeVersion = process.version,
    npmCommand = 'install',
    npmPath = getNpmDirPath(),
    npmVersion,
    platform = process.platform,
  } = { __proto__: null, ...options } as NpmConfigOptions
  const config = new NpmConfig({
    argv: [],
    cwd,
    definitions: npmConfigDefinitions,
    execPath,
    env: { ...env },
    flatten: npmConfigFlatten,
    npmPath,
    platform,
    shorthands: npmConfigShorthands,
  })
  await config.load()
  const flatConfig = { __proto__: null, ...config.flat } as ArboristOptions

  if (nodeVersion) {
    flatConfig.nodeVersion = nodeVersion
  }
  if (npmCommand) {
    flatConfig.npmCommand = npmCommand
  }
  if (npmVersion) {
    flatConfig.npmVersion = npmVersion.toString()
  }
  return flatConfig
}
