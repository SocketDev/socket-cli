/**
 * Main constants module that re-exports from semantic constant modules.
 * This maintains backward compatibility while using the new modular structure.
 */

// Import all semantic constant modules from registry
import * as registryAgents from '@socketsecurity/registry/constants/agents'
import * as registryCore from '@socketsecurity/registry/constants/core'
import { kInternalsSymbol } from '@socketsecurity/registry/constants/core'
import * as registryEncoding from '@socketsecurity/registry/constants/encoding'
import * as registryGithub from '@socketsecurity/registry/constants/github'
import * as registryLicenses from '@socketsecurity/registry/constants/licenses'
import * as registryNode from '@socketsecurity/registry/constants/node'
import * as registryPackages from '@socketsecurity/registry/constants/packages'
import * as registryPaths from '@socketsecurity/registry/constants/paths'
import * as registryPlatform from '@socketsecurity/registry/constants/platform'
import * as registryProcess from '@socketsecurity/registry/constants/process'
import * as registrySocket from '@socketsecurity/registry/constants/socket'
import * as registryTesting from '@socketsecurity/registry/constants/testing'
import * as registryTypescript from '@socketsecurity/registry/constants/typescript'

// Import CLI-specific semantic constant modules.
import * as cliAlerts from './constants/alerts.mjs'
import * as cliBuild from './constants/build.mjs'
import * as cliCache from './constants/cache.mjs'
import * as cliCli from './constants/cli.mjs'
import * as cliConfig from './constants/config.mjs'
import ENV from './constants/env.mts'
import * as cliErrors from './constants/errors.mjs'
import * as cliGithub from './constants/github.mjs'
import * as cliHttp from './constants/http.mjs'
import * as cliPackages from './constants/packages.mjs'
import * as cliPaths from './constants/paths.mjs'
import * as cliReporting from './constants/reporting.mjs'
import * as cliShadow from './constants/shadow.mjs'
import * as cliSocket from './constants/socket.mjs'

// Import ENV module

// Re-export registry constants (these get overridden by CLI-specific if there are conflicts)
export * from '@socketsecurity/registry/constants/agents'
export * from '@socketsecurity/registry/constants/core'
export * from '@socketsecurity/registry/constants/encoding'
export * from '@socketsecurity/registry/constants/github'
export * from '@socketsecurity/registry/constants/licenses'
export * from '@socketsecurity/registry/constants/node'
export * from '@socketsecurity/registry/constants/packages'
export * from '@socketsecurity/registry/constants/paths'
export * from '@socketsecurity/registry/constants/platform'
export * from '@socketsecurity/registry/constants/process'
export * from '@socketsecurity/registry/constants/socket'
export * from '@socketsecurity/registry/constants/testing'
export * from '@socketsecurity/registry/constants/typescript'
// Re-export all semantic constant modules
export * from './constants/alerts.mjs'
export * from './constants/build.mjs'
export * from './constants/cache.mjs'
export * from './constants/cli.mjs'
export * from './constants/config.mjs'
export * from './constants/errors.mjs'
export * from './constants/github.mjs'
export * from './constants/http.mjs'
export * from './constants/packages.mjs'
export * from './constants/paths.mjs'
export * from './constants/reporting.mjs'
export * from './constants/shadow.mjs'
export * from './constants/socket.mjs'

// Export ENV
export { ENV }

// Note: kInternalsSymbol is exported from @socketsecurity/registry/constants/core above.
// No need to re-export it here.
export const registryConstantsAttribs = {}

export type { Remap } from '@socketsecurity/registry/lib/objects'
export type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'
// Type exports
export type { Agent } from './utils/ecosystem/environment.mjs'

export type RegistryEnv = typeof ENV
export type RegistryInternals = {
  getIpc?: () => IpcObject | undefined
  getSentry?: () => Sentry | undefined
  setSentry?: (sentry: Sentry) => void
}

export type Sentry = any

export type IpcObject = Readonly<{
  SOCKET_CLI_FIX?: string | undefined
  SOCKET_CLI_OPTIMIZE?: boolean | undefined
  SOCKET_CLI_SHADOW_ACCEPT_RISKS?: boolean | undefined
  SOCKET_CLI_SHADOW_API_TOKEN?: string | undefined
  SOCKET_CLI_SHADOW_BIN?: string | undefined
  SOCKET_CLI_SHADOW_PROGRESS?: boolean | undefined
  SOCKET_CLI_SHADOW_SILENT?: boolean | undefined
}>

export type ProcessEnv = {
  [K in keyof typeof ENV]?: string | undefined
}

// Default export for backward compatibility.
const constants = {
  // Registry constants
  ...registryAgents,
  ...registryCore,
  ...registryEncoding,
  ...registryGithub,
  ...registryLicenses,
  ...registryNode,
  ...registryPackages,
  ...registryPaths,
  ...registryPlatform,
  ...registryProcess,
  ...registrySocket,
  ...registryTesting,
  ...registryTypescript,
  // CLI constants (these override registry if there are conflicts)
  ...cliAlerts,
  ...cliBuild,
  ...cliCache,
  ...cliCli,
  ...cliConfig,
  ...cliErrors,
  ...cliGithub,
  ...cliHttp,
  ...cliPackages,
  ...cliPaths,
  ...cliReporting,
  ...cliShadow,
  ...cliSocket,
  // Add ENV
  ENV,
  // Add property getters for shadow bin paths to maintain backward compatibility.
  get shadowBinPath() {
    return cliPaths.getShadowBinPath()
  },
  get shadowNpmBinPath() {
    return cliPaths.getShadowNpmBinPath()
  },
  get shadowNpmInjectPath() {
    return cliPaths.getShadowNpmInjectPath()
  },
  get shadowNpxBinPath() {
    return cliPaths.getShadowNpxBinPath()
  },
  get shadowPnpmBinPath() {
    return cliPaths.getShadowPnpmBinPath()
  },
  get shadowYarnBinPath() {
    return cliPaths.getShadowYarnBinPath()
  },
  get instrumentWithSentryPath() {
    return cliPaths.getInstrumentWithSentryPath()
  },
  // Add RC path getters.
  get bashRcPath() {
    return cliPaths.getBashRcPath()
  },
  get zshRcPath() {
    return cliPaths.getZshRcPath()
  },
  // Add CLI binary path getter.
  get binCliPath() {
    return cliPaths.getBinCliPath()
  },
  // Add cache path getter.
  get githubCachePath() {
    return cliPaths.getGithubCachePath()
  },
  // Add socket app data path getter.
  get socketAppDataPath() {
    return cliPaths.getSocketAppDataPath()
  },
  // Re-export spinner from registry process constants.
  get spinner() {
    return registryProcess.getSpinner()
  },
  // Add node flag getters to maintain backward compatibility.
  get execPath() {
    return registryNode.getExecPath()
  },
  get nodeDebugFlags() {
    return registryNode.getNodeDebugFlags()
  },
  get nodeHardenFlags() {
    return registryNode.getNodeHardenFlags()
  },
  get nodeNoWarningsFlags() {
    return registryNode.getNodeNoWarningsFlags()
  },
  // Add registry getters.
  get abortSignal() {
    return registryProcess.getAbortSignal()
  },
  get maintainedNodeVersions() {
    return registryNode.getMaintainedNodeVersions()
  },
  get npmExecPath() {
    return registryAgents.getNpmExecPath()
  },
  get pnpmExecPath() {
    return registryAgents.getPnpmExecPath()
  },
  get supportsNodePermissionFlag() {
    return registryNode.supportsNodePermissionFlag()
  },
  get SUPPORTS_NODE_PERMISSION_FLAG() {
    return registryNode.supportsNodePermissionFlag()
  },
  // Add processEnv getter to access process.env.
  get processEnv() {
    return process.env
  },
  // Minimum versions by package manager agent.
  // These are the minimum supported versions for each package manager.
  get minimumVersionByAgent(): Map<string, string> {
    return new Map([
      // Bun >=1.1.39 supports the text-based lockfile.
      [this.BUN, '1.1.39'],
      // The npm version bundled with Node 18.
      [this.NPM, '10.8.2'],
      // 8.x is the earliest version to support Node 18.
      [this.PNPM, '8.15.7'],
      // 4.x supports >= Node 18.12.0
      [this.YARN_BERRY, '4.0.0'],
      // Latest 1.x.
      [this.YARN_CLASSIC, '1.22.22'],
      // vlt does not support overrides so we don't gate on it.
      [this.VLT, '*'],
    ])
  },
  // Add kInternalsSymbol using computed property (imported from registry/constants/core).
  [kInternalsSymbol]: {
    // Internal properties can be added here if needed.
    setSentry: undefined as ((sentry: any) => void) | undefined,
  } as RegistryInternals,
}

// Helper function to access internals symbol property.
export function getInternals(obj: typeof constants): RegistryInternals {
  return obj[kInternalsSymbol]
}

export default constants
