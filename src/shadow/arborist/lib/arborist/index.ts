import { kRiskyReify, reify } from './reify'
import { getArboristClassPath } from '../../../npm-paths'

import type { ArboristClass, ArboristReifyOptions } from './types'
import type { SafeNode } from '../node'

export const Arborist: ArboristClass = require(getArboristClassPath())

export const kCtorArgs = Symbol('ctorArgs')

const safeOptOverrides = {
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
        ...ctorArgs[0],
        ...safeOptOverrides
      },
      ...ctorArgs.slice(1)
    )
    ;(this as any)[kCtorArgs] = ctorArgs
  }

  async [kRiskyReify](
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<SafeNode> {
    const arb = new Arborist(...(this as any)[kCtorArgs])
    //arb.idealTree = this.idealTree
    const ret = await arb.reify(...args)
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
    if (options.dryRun) {
      return await this[kRiskyReify](...args)
    }
    Object.assign(options, safeOptOverrides)
    const old = args[0]
    args[0] = options
    await super.reify(...args)
    args[0] = old
    return await Reflect.apply(reify, this, args)
  }
}
