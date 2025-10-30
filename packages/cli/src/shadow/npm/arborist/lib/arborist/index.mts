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
  SOCKET_CLI_SHADOW_PROGRESS,
  SOCKET_CLI_SHADOW_SILENT,
  SOCKET_CLI_VIEW_ALL_RISKS,
} from '../../../../../constants/shadow.mts'
import { findUp } from '../../../../../utils/fs/find-up.mjs'
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
    // Note: Registry no longer provides IPC, always use risky reify.
    return await this[kRiskyReify](...args)
  }
}
