import { reify } from './reify'
import { arboristClassPath } from '../../../npm-paths'

import type { SafeDiff } from './diff'
import type { SafeNode } from '../node'
import type {
  Options as ArboristOptions,
  Advisory as BaseAdvisory,
  Arborist as BaseArborist,
  AuditReport as BaseAuditReport,
  ReifyOptions
} from '@npmcli/arborist'

export type ArboristClass = ArboristInstance & {
  new (...args: any): ArboristInstance
}

export type ArboristInstance = Omit<
  typeof BaseArborist,
  'actualTree' | 'auditReport' | 'diff' | 'idealTree' | 'reify'
> & {
  auditReport?: AuditReportInstance | null | undefined
  actualTree?: SafeNode | null | undefined
  diff: SafeDiff | null
  idealTree?: SafeNode | null | undefined
  reify(options?: ArboristReifyOptions): Promise<SafeNode>
}

export type ArboristReifyOptions = ReifyOptions & ArboristOptions

export type AuditReportInstance = Omit<BaseAuditReport, 'report'> & {
  report: { [dependency: string]: AuditAdvisory[] }
}

export type AuditAdvisory = Omit<BaseAdvisory, 'id'> & {
  id: number
  cwe: string[]
  cvss: {
    score: number
    vectorString: string
  }
  vulnerable_versions: string
}

export const Arborist: ArboristClass = require(arboristClassPath)
export const kCtorArgs = Symbol('ctorArgs')
export const kRiskyReify = Symbol('riskyReify')

// Implementation code not related to our custom behavior is based on
// https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/arborist/index.js:
export class SafeArborist extends Arborist {
  constructor(...ctorArgs: ConstructorParameters<ArboristClass>) {
    super(
      {
        ...ctorArgs[0],
        audit: true,
        dryRun: true,
        ignoreScripts: true,
        save: false,
        saveBundle: false,
        // progress: false,
        fund: false
      },
      ...ctorArgs.slice(1)
    )
    ;(this as any)[kCtorArgs] = ctorArgs
  }

  async [kRiskyReify](
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<SafeNode> {
    // SafeArborist has suffered side effects and must be rebuilt from scratch.
    const arb = new Arborist(...(this as any)[kCtorArgs])
    arb.idealTree = this.idealTree
    const ret = await arb.reify(...args)
    Object.assign(this, arb)
    return ret
  }

  // @ts-ignore Incorrectly typed.
  override async reify(
    this: SafeArborist,
    ...args: Parameters<InstanceType<ArboristClass>['reify']>
  ): Promise<SafeNode> {
    const options = <ArboristReifyOptions>(args[0] ? { ...args[0] } : {})
    if (options.dryRun) {
      return await this[kRiskyReify](...args)
    }
    const old = {
      ...options,
      dryRun: false,
      save: Boolean(options.save ?? true),
      saveBundle: Boolean(options.saveBundle ?? false)
    }
    args[0] = options
    options.dryRun = true
    options.save = false
    options.saveBundle = false
    await super.reify(...args)
    options.dryRun = old.dryRun
    options.save = old.save
    options.saveBundle = old.saveBundle
    return await Reflect.apply(reify, this, args)
  }
}
