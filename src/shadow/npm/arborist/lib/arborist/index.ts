import process from 'node:process'

import { stripIndents } from 'common-tags'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../../../../constants'
import { getAlertsMapFromArborist } from '../../../../../utils/lockfile/package-lock-json'
import { logAlertsMap } from '../../../../../utils/socket-package-alert'
import { getArboristClassPath } from '../../../paths'

import type { ArboristClass, ArboristReifyOptions } from './types'
import type { SafeNode } from '../node'

const {
  NPM,
  NPX,
  SOCKET_CLI_ACCEPT_RISKS,
  SOCKET_CLI_SAFE_BIN,
  SOCKET_CLI_SAFE_PROGRESS,
  SOCKET_CLI_VIEW_ALL_RISKS,
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { getIpc }
} = constants

export const SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES = {
  __proto__: null,
  audit: false,
  dryRun: true,
  fund: false,
  ignoreScripts: true,
  progress: false,
  save: false,
  saveBundle: false,
  silent: true
}

export const kCtorArgs = Symbol('ctorArgs')

export const kRiskyReify = Symbol('riskyReify')

export const Arborist: ArboristClass = require(getArboristClassPath())

// Implementation code not related to our custom behavior is based on
// https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/arborist/index.js:
export class SafeArborist extends Arborist {
  constructor(...ctorArgs: ConstructorParameters<ArboristClass>) {
    super(
      {
        path:
          (ctorArgs.length ? ctorArgs[0]?.path : undefined) ?? process.cwd(),
        ...(ctorArgs.length ? ctorArgs[0] : undefined),
        ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
      },
      ...ctorArgs.slice(1)
    )
    ;(this as any)[kCtorArgs] = ctorArgs
  }

  async [kRiskyReify](
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<SafeNode> {
    const ctorArgs = (this as any)[kCtorArgs]
    const arb = new Arborist(
      {
        ...(ctorArgs.length ? ctorArgs[0] : undefined),
        progress: false
      },
      ...ctorArgs.slice(1)
    )
    const ret = await (arb.reify as (...args: any[]) => Promise<SafeNode>)(
      {
        ...(args.length ? args[0] : undefined),
        progress: false
      },
      ...args.slice(1)
    )
    Object.assign(this, arb)
    return ret
  }

  // @ts-ignore Incorrectly typed.
  override async reify(
    this: SafeArborist,
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<SafeNode> {
    const options = {
      __proto__: null,
      ...(args.length ? args[0] : undefined)
    } as ArboristReifyOptions
    const ipc = await getIpc()
    const binName = ipc[SOCKET_CLI_SAFE_BIN]
    if (!binName) {
      return await this[kRiskyReify](...args)
    }
    await super.reify(
      {
        ...options,
        ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
        progress: false
      },
      // @ts-ignore: TS gets grumpy about rest parameters.
      ...args.slice(1)
    )
    const progress = ipc[SOCKET_CLI_SAFE_PROGRESS]
    const spinner =
      options['silent'] || !progress
        ? undefined
        : // Lazily access constants.spinner.
          constants.spinner
    const isSafeNpm = binName === NPM
    const isSafeNpx = binName === NPX
    const alertsMap = await getAlertsMapFromArborist(this, {
      spinner,
      include:
        options.dryRun ||
        options['yes'] ||
        // Lazily access constants.ENV[SOCKET_CLI_ACCEPT_RISKS].
        constants.ENV[SOCKET_CLI_ACCEPT_RISKS]
          ? {
              blocked: true,
              critical: false,
              cve: false,
              unfixable: false
            }
          : {
              existing: isSafeNpx,
              unfixable: isSafeNpm
            }
    })
    if (alertsMap.size) {
      process.exitCode = 1
      logAlertsMap(alertsMap, {
        // Lazily access constants.ENV[SOCKET_CLI_VIEW_ALL_RISKS].
        hideAt: constants.ENV[SOCKET_CLI_VIEW_ALL_RISKS] ? 'none' : 'middle',
        output: process.stderr
      })
      throw new Error(
        stripIndents`
          Socket ${binName} exiting due to risks.
          View all risks - Rerun with environment variable ${SOCKET_CLI_VIEW_ALL_RISKS}=1.
          Accept risks - Rerun with environment variable ${SOCKET_CLI_ACCEPT_RISKS}=1.
        `
      )
    } else if (!options['silent']) {
      logger.success(`Socket ${binName} found no risks!`)
      if (binName === NPX) {
        logger.log(`Running ${options.add![0]}`)
      }
    }
    return await this[kRiskyReify](...args)
  }
}
