/** @fileoverview Safe Arborist class implementation for Socket CLI. Extends npm's Arborist to intercept buildIdealTree and reify operations for security scanning before package installation. */

// @ts-expect-error
import UntypedArborist from '@npmcli/arborist/lib/arborist/index.js'

import { getSpinner } from '@socketsecurity/lib/constants/process'
import { logger } from '@socketsecurity/lib/logger'

import { NPX } from '../../../../../constants/agents.mts'
import ENV from '../../../../../constants/env.mts'
import { NODE_MODULES } from '../../../../../constants/packages.mts'
import {
  SOCKET_CLI_ACCEPT_RISKS,
  SOCKET_CLI_SHADOW_ACCEPT_RISKS,
  SOCKET_CLI_SHADOW_API_TOKEN,
  SOCKET_CLI_SHADOW_BIN,
  SOCKET_CLI_SHADOW_PROGRESS,
  SOCKET_CLI_SHADOW_SILENT,
  SOCKET_CLI_VIEW_ALL_RISKS,
} from '../../../../../constants/shadow.mts'
import { findUp } from '../../../../../utils/fs/find-up.mjs'
import { getIpcExtra } from '../../../../../utils/ipc.mjs'
import { logAlertsMap } from '../../../../../utils/socket/package-alert.mts'
import {
  getAlertsMapFromArborist,
  getDetailsFromDiff,
} from '../../../arborist-helpers.mts'

import type {
  ArboristClass,
  ArboristReifyOptions,
  NodeClass,
} from '../../types.mts'

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

  override async reify(
    this: SafeArborist,
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<NodeClass> {
    const options = {
      __proto__: null,
      ...(args.length ? args[0] : undefined),
    } as ArboristReifyOptions

    const ipc = getIpcExtra()

    const binName = ipc?.[SOCKET_CLI_SHADOW_BIN]
    if (!binName) {
      return await this[kRiskyReify](...args)
    }

    await super.reify(
      {
        ...options,
        ...SAFE_NO_SAVE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
        progress: false,
      },
      // @ts-expect-error: TypeScript gets grumpy about rest parameters.
      ...args.slice(1),
    )

    const shadowAcceptRisks = !!ipc?.[SOCKET_CLI_SHADOW_ACCEPT_RISKS]
    const shadowProgress = !!ipc?.[SOCKET_CLI_SHADOW_PROGRESS]
    const shadowSilent = !!ipc?.[SOCKET_CLI_SHADOW_SILENT]

    const acceptRisks = shadowAcceptRisks || ENV.SOCKET_CLI_ACCEPT_RISKS
    const reportOnlyBlocking =
      acceptRisks || options['dryRun'] || options['yes']
    const silent = !!options['silent']
    const spinnerInstance =
      silent || !shadowProgress ? undefined : (getSpinner() ?? undefined)

    const isShadowNpx = binName === NPX
    const hasExisting = await findUp(NODE_MODULES, {
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
      apiToken: ipc?.[SOCKET_CLI_SHADOW_API_TOKEN],
      spinner: spinnerInstance,
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
      const viewAllRisks = ENV.SOCKET_CLI_VIEW_ALL_RISKS
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
    }
    if (!silent && !shadowSilent) {
      logger.success(
        `Socket ${binName} ${acceptRisks ? 'accepted' : 'found no'}${hasExisting ? ' new' : ''} risks`,
      )
      if (isShadowNpx) {
        logger.log(`Running ${options.add?.[0]}`)
      }
    }

    return await this[kRiskyReify](...args)
  }
}
