// @ts-ignore
import UntypedArborist from '@npmcli/arborist/lib/arborist/index.js'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../../../../constants.mts'
import { logAlertsMap } from '../../../../../utils/socket-package-alert.mts'
import { getAlertsMapFromArborist } from '../../../arborist-helpers.mts'

import type {
  ArboristClass,
  ArboristReifyOptions,
  NodeClass,
} from '../../types.mts'

const {
  NPM,
  NPX,
  SOCKET_CLI_ACCEPT_RISKS,
  SOCKET_CLI_SAFE_BIN,
  SOCKET_CLI_SAFE_PROGRESS,
  SOCKET_CLI_VIEW_ALL_RISKS,
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { getIpc },
} = constants

export const SAFE_NO_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES = {
  __proto__: null,
  audit: false,
  dryRun: true,
  fund: false,
  ignoreScripts: true,
  progress: false,
  save: false,
  saveBundle: false,
  silent: true,
}

export const SAFE_WITH_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES = {
  // @ts-ignore
  __proto__: null,
  ...SAFE_NO_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  dryRun: false,
  save: true,
}

export const kCtorArgs = Symbol('ctorArgs')

export const kRiskyReify = Symbol('riskyReify')

export const Arborist: ArboristClass = UntypedArborist

// Implementation code not related to our custom behavior is based on
// https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/arborist/index.js:
export class SafeArborist extends Arborist {
  constructor(...ctorArgs: ConstructorParameters<ArboristClass>) {
    super(
      {
        path:
          (ctorArgs.length ? ctorArgs[0]?.path : undefined) ?? process.cwd(),
        ...(ctorArgs.length ? ctorArgs[0] : undefined),
        ...SAFE_NO_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
      },
      ...ctorArgs.slice(1),
    )
    ;(this as any)[kCtorArgs] = ctorArgs
  }

  async [kRiskyReify](
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<NodeClass> {
    const ctorArgs = (this as any)[kCtorArgs]
    const arb = new Arborist(
      {
        ...(ctorArgs.length ? ctorArgs[0] : undefined),
        progress: false,
      },
      ...ctorArgs.slice(1),
    )
    const ret = await (arb.reify as (...args: any[]) => Promise<NodeClass>)(
      {
        ...(args.length ? args[0] : undefined),
        progress: false,
      },
      ...args.slice(1),
    )
    Object.assign(this, arb)
    return ret
  }

  // @ts-ignore Incorrectly typed.
  override async reify(
    this: SafeArborist,
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<NodeClass> {
    const options = {
      __proto__: null,
      ...(args.length ? args[0] : undefined),
    } as ArboristReifyOptions
    const ipc = await getIpc()
    const binName = ipc[SOCKET_CLI_SAFE_BIN]
    if (!binName) {
      return await this[kRiskyReify](...args)
    }
    await super.reify(
      {
        ...options,
        ...SAFE_NO_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
        progress: false,
      },
      // @ts-ignore: TypeScript gets grumpy about rest parameters.
      ...args.slice(1),
    )
    // Lazily access constants.ENV.SOCKET_CLI_ACCEPT_RISKS.
    const acceptRisks = constants.ENV.SOCKET_CLI_ACCEPT_RISKS
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
      filter:
        acceptRisks || options.dryRun || options['yes']
          ? {
              actions: ['error'],
              blocked: true,
              critical: false,
              cve: false,
              existing: true,
              fixable: false,
            }
          : {
              existing: isSafeNpx,
              fixable: !isSafeNpm,
            },
    })
    if (alertsMap.size) {
      process.exitCode = 1
      // Lazily access constants.ENV.SOCKET_CLI_VIEW_ALL_RISKS.
      const viewAllRisks = constants.ENV.SOCKET_CLI_VIEW_ALL_RISKS
      logAlertsMap(alertsMap, {
        hideAt: viewAllRisks ? 'none' : 'middle',
        output: process.stderr,
      })
      throw new Error(
        `
          Socket ${binName} exiting due to risks.${
            viewAllRisks
              ? ''
              : `\nView all risks - Rerun with environment variable ${SOCKET_CLI_VIEW_ALL_RISKS}=1.`
          }${
            acceptRisks
              ? ''
              : `\nAccept risks - Rerun with environment variable ${SOCKET_CLI_ACCEPT_RISKS}=1.`
          }
        `.trim(),
      )
    } else if (!options['silent']) {
      logger.success(
        `Socket ${binName} ${acceptRisks ? 'accepted' : 'found no'} risks`,
      )
      if (binName === NPX) {
        logger.log(`Running ${options.add![0]}`)
      }
    }
    return await this[kRiskyReify](...args)
  }
}
