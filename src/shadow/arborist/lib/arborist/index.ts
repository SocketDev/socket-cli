import process from 'node:process'

import { kRiskyReify, reify } from './reify'
import constants from '../../../../constants'
import { getArboristClassPath } from '../../../npm-paths'

import type { ArboristClass, ArboristReifyOptions } from './types'
import type { SafeNode } from '../node'

const {
  SOCKET_CLI_SAFE_WRAPPER,
  kInternalsSymbol,
  [kInternalsSymbol as unknown as 'Symbol(kInternalsSymbol)']: { getIPC }
} = constants

export const Arborist: ArboristClass = require(getArboristClassPath())

export const kCtorArgs = Symbol('ctorArgs')

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
    const options = <ArboristReifyOptions>{
      __proto__: null,
      ...(args.length ? args[0] : undefined)
    }
    const safeArgs = [
      {
        ...options,
        progress: false
      },
      ...args.slice(1)
    ]
    if (options.dryRun || !(await getIPC(SOCKET_CLI_SAFE_WRAPPER))) {
      return await this[kRiskyReify](...safeArgs)
    }
    Object.assign(options, SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES)
    const old = args[0]
    args[0] = options
    await super.reify(...safeArgs)
    args[0] = old
    return await Reflect.apply(reify, this, safeArgs)
  }
}
