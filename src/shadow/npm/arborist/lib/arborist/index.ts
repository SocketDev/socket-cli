import process from 'node:process'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'

import constants from '../../../../../constants'
import { getAlertsMapFromArborist } from '../../../../../utils/lockfile/package-lock-json'
import { logAlertsMap } from '../../../../../utils/socket-package-alert'
import { getArboristClassPath } from '../../../paths'

import type { ArboristClass, ArboristReifyOptions } from './types'
import type { SafeNode } from '../node'

const {
  NPM,
  NPX,
  SOCKET_CLI_SAFE_WRAPPER,
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { getIPC }
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
    const safeWrapperName = options.dryRun
      ? undefined
      : await getIPC(SOCKET_CLI_SAFE_WRAPPER)
    const isSafeNpm = safeWrapperName === NPM
    const isSafeNpx = safeWrapperName === NPX
    if (!safeWrapperName || (isSafeNpx && options['yes'])) {
      return await this[kRiskyReify](...args)
    }

    // Lazily access constants.spinner.
    const { spinner } = constants
    await super.reify(
      {
        ...options,
        ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
        progress: false
      },
      // @ts-ignore: TS gets grumpy about rest parameters.
      ...args.slice(1)
    )
    const alertsMap = await getAlertsMapFromArborist(this, {
      spinner,
      include: {
        existing: isSafeNpx,
        unfixable: isSafeNpm
      }
    })
    if (alertsMap.size) {
      logAlertsMap(alertsMap, { output: process.stderr })
      if (
        !(await confirm({
          message: 'Accept risks of installing these packages?',
          default: false
        }))
      ) {
        throw new Error('Socket npm exiting due to risks')
      }
    } else {
      logger.success('Socket npm found no risks!')
    }
    return await this[kRiskyReify](...args)
  }
}
