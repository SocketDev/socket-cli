// @ts-ignore
import UntypedArborist from '@npmcli/arborist/lib/arborist/index.js'

import { debugDir } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../../../../constants.mts'
import { findUp } from '../../../../../utils/fs.mts'
import { logAlertsMap } from '../../../../../utils/socket-package-alert.mts'
import {
  getAlertsMapFromArborist,
  getDetailsFromDiff,
} from '../../../arborist-helpers.mts'

import type {
  ArboristClass,
  ArboristReifyOptions,
  NodeClass,
} from '../../types.mts'

const {
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
    debugDir('inspect', { ipc })

    const binName = ipc[constants.SOCKET_CLI_SHADOW_BIN]
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

    const shadowAcceptRisks = !!ipc[constants.SOCKET_CLI_SHADOW_ACCEPT_RISKS]
    const shadowProgress = !!ipc[constants.SOCKET_CLI_SHADOW_PROGRESS]
    const shadowSilent = !!ipc[constants.SOCKET_CLI_SHADOW_SILENT]

    const acceptRisks =
      shadowAcceptRisks || constants.ENV.SOCKET_CLI_ACCEPT_RISKS
    const reportOnlyBlocking = acceptRisks || options.dryRun || options['yes']
    const silent = !!options['silent']
    const spinner = silent || !shadowProgress ? undefined : constants.spinner

    const isShadowNpx = binName === 'npx'
    const hasExisting = await findUp('node_modules', {
      cwd: process.cwd(),
      onlyDirectories: true,
    })
    const shouldCheckExisting = reportOnlyBlocking ? true : isShadowNpx

    const needInfoOn = getDetailsFromDiff(this.diff, {
      filter: {
        existing: shouldCheckExisting,
      },
    })

    const alertsMap = await getAlertsMapFromArborist(this, needInfoOn, {
      apiToken: ipc[constants.SOCKET_CLI_SHADOW_API_TOKEN],
      spinner,
      filter: reportOnlyBlocking
        ? {
            actions: ['error'],
            blocked: true,
            existing: shouldCheckExisting,
          }
        : {
            actions: ['error', 'monitor', 'warn'],
            existing: shouldCheckExisting,
          },
    })

    if (alertsMap.size) {
      process.exitCode = 1
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
              : `\nView all risks - Rerun with environment variable ${constants.SOCKET_CLI_VIEW_ALL_RISKS}=1.`
          }${
            acceptRisks
              ? ''
              : `\nAccept risks - Rerun with environment variable ${constants.SOCKET_CLI_ACCEPT_RISKS}=1.`
          }
        `.trim(),
      )
    } else if (!silent && !shadowSilent) {
      logger.success(
        `Socket ${binName} ${acceptRisks ? 'accepted' : 'found no'}${hasExisting ? ' new' : ''} risks`,
      )
      if (isShadowNpx) {
        logger.log(`Running ${options.add![0]}`)
      }
    }

    return await this[kRiskyReify](...args)
  }
}
