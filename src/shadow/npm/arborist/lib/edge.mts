import { createRequire } from 'node:module'

import { depValid } from './dep-valid.mts'
import { SafeNode } from './node.mts'
import { SafeOverrideSet } from './override-set.mts'
import { getArboristEdgeClassPath } from '../../paths.mts'

import type { Edge as BaseEdge, DependencyProblem } from '@npmcli/arborist'

const require = createRequire(import.meta.url)

type EdgeClass = Omit<
  BaseEdge,
  | 'accept'
  | 'detach'
  | 'optional'
  | 'overrides'
  | 'peer'
  | 'peerConflicted'
  | 'rawSpec'
  | 'reload'
  | 'satisfiedBy'
  | 'spec'
  | 'to'
> & {
  optional: boolean
  overrides: SafeOverrideSet | undefined
  peer: boolean
  peerConflicted: boolean
  rawSpec: string
  get accept(): string | undefined
  get spec(): string
  get to(): SafeNode | null
  new (...args: any): EdgeClass
  detach(): void
  reload(hard?: boolean): void
  satisfiedBy(node: SafeNode): boolean
}

export type EdgeOptions = {
  type: string
  name: string
  spec: string
  from: SafeNode
  accept?: string | undefined
  overrides?: SafeOverrideSet | undefined
  to?: SafeNode | undefined
}

export type ErrorStatus = DependencyProblem | 'OK'

export type Explanation = {
  type: string
  name: string
  spec: string
  bundled: boolean
  overridden: boolean
  error: ErrorStatus | undefined
  rawSpec: string | undefined
  from: object | undefined
} | null

export const Edge: EdgeClass = require(getArboristEdgeClassPath())

// The Edge class makes heavy use of private properties which subclasses do NOT
// have access to. So we have to recreate any functionality that relies on those
// private properties and use our own "safe" prefixed non-conflicting private
// properties. Implementation code not related to patch https://github.com/npm/cli/pull/8089
// is based on https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/edge.js.
//
// The npm application
// Copyright (c) npm, Inc. and Contributors
// Licensed on the terms of The Artistic License 2.0
//
// An edge in the dependency graph.
// Represents a dependency relationship of some kind.
export class SafeEdge extends Edge {
  #safeError: ErrorStatus | null
  #safeExplanation: Explanation | undefined
  #safeFrom: SafeNode | null
  #safeTo: SafeNode | null

  constructor(options: EdgeOptions) {
    const { from } = options
    // Defer to supper to validate options and assign non-private values.
    super(options)
    if (from.constructor !== SafeNode) {
      Reflect.setPrototypeOf(from, SafeNode.prototype)
    }
    this.#safeError = null
    this.#safeExplanation = null
    this.#safeFrom = from
    this.#safeTo = null
    this.reload(true)
  }

  override get bundled() {
    return !!this.#safeFrom?.package?.bundleDependencies?.includes(this.name)
  }

  override get error() {
    if (!this.#safeError) {
      if (!this.#safeTo) {
        if (this.optional) {
          this.#safeError = null
        } else {
          this.#safeError = 'MISSING'
        }
      } else if (
        this.peer &&
        this.#safeFrom === this.#safeTo.parent &&
        // Patch adding "?." use based on
        // https://github.com/npm/cli/pull/8089.
        !this.#safeFrom?.isTop
      ) {
        this.#safeError = 'PEER LOCAL'
      } else if (!this.satisfiedBy(this.#safeTo)) {
        this.#safeError = 'INVALID'
      }
      // Patch adding "else if" condition is based on
      // https://github.com/npm/cli/pull/8089.
      else if (
        this.overrides &&
        this.#safeTo.edgesOut.size &&
        SafeOverrideSet.doOverrideSetsConflict(
          this.overrides,
          this.#safeTo.overrides,
        )
      ) {
        // Any inconsistency between the edge's override set and the target's
        // override set is potentially problematic. But we only say the edge is
        // in error if the override sets are plainly conflicting. Note that if
        // the target doesn't have any dependencies of their own, then this
        // inconsistency is irrelevant.
        this.#safeError = 'INVALID'
      } else {
        this.#safeError = 'OK'
      }
    }
    if (this.#safeError === 'OK') {
      return null
    }
    return this.#safeError
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get from() {
    return this.#safeFrom
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get spec(): string {
    if (
      this.overrides?.value &&
      this.overrides.value !== '*' &&
      this.overrides.name === this.name
    ) {
      if (this.overrides.value.startsWith('$')) {
        const ref = this.overrides.value.slice(1)
        // We may be a virtual root, if we are we want to resolve reference
        // overrides from the real root, not the virtual one.
        //
        // Patch adding "?." use based on
        // https://github.com/npm/cli/pull/8089.
        const pkg = this.#safeFrom?.sourceReference
          ? this.#safeFrom?.sourceReference.root.package
          : this.#safeFrom?.root?.package
        if (pkg?.devDependencies?.[ref]) {
          return pkg.devDependencies[ref] as string
        }
        if (pkg?.optionalDependencies?.[ref]) {
          return pkg.optionalDependencies[ref] as string
        }
        if (pkg?.dependencies?.[ref]) {
          return pkg.dependencies[ref] as string
        }
        if (pkg?.peerDependencies?.[ref]) {
          return pkg.peerDependencies[ref] as string
        }
        throw new Error(`Unable to resolve reference ${this.overrides.value}`)
      }
      return this.overrides.value
    }
    return this.rawSpec
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get to() {
    return this.#safeTo
  }

  override detach() {
    this.#safeExplanation = null
    // Patch replacing
    // if (this.#to) {
    //   this.#to.edgesIn.delete(this)
    // }
    // this.#from.edgesOut.delete(this.#name)
    // is based on https://github.com/npm/cli/pull/8089.
    this.#safeTo?.deleteEdgeIn(this)
    this.#safeFrom?.edgesOut.delete(this.name)
    this.#safeTo = null
    this.#safeError = 'DETACHED'
    this.#safeFrom = null
  }

  // Return the edge data, and an explanation of how that edge came to be here.
  // @ts-ignore: Edge#explain is defined with an unused `seen = []` param.
  override explain() {
    if (!this.#safeExplanation) {
      const explanation: Explanation = {
        type: this.type,
        name: this.name,
        spec: this.spec,
        bundled: false,
        overridden: false,
        error: undefined,
        from: undefined,
        rawSpec: undefined,
      }
      if (this.rawSpec !== this.spec) {
        explanation.rawSpec = this.rawSpec
        explanation.overridden = true
      }
      if (this.bundled) {
        explanation.bundled = this.bundled
      }
      if (this.error) {
        explanation.error = this.error
      }
      if (this.#safeFrom) {
        explanation.from = this.#safeFrom.explain()
      }
      this.#safeExplanation = explanation
    }
    return this.#safeExplanation
  }

  override reload(hard = false) {
    this.#safeExplanation = null
    // Patch replacing
    // if (this.#from.overrides) {
    // is based on https://github.com/npm/cli/pull/8089.
    let needToUpdateOverrideSet = false
    let newOverrideSet
    let oldOverrideSet
    if (this.#safeFrom?.overrides) {
      newOverrideSet = this.#safeFrom.overrides.getEdgeRule(this)
      if (newOverrideSet && !newOverrideSet.isEqual(this.overrides)) {
        // If there's a new different override set we need to propagate it to
        // the nodes. If we're deleting the override set then there's no point
        // propagating it right now since it will be filled with another value
        // later.
        needToUpdateOverrideSet = true
        oldOverrideSet = this.overrides
        this.overrides = newOverrideSet
      }
    } else {
      this.overrides = undefined
    }
    // Patch adding "?." use based on
    // https://github.com/npm/cli/pull/8089.
    const newTo = this.#safeFrom?.resolve(this.name)
    if (newTo !== this.#safeTo) {
      // Patch replacing
      // this.#to.edgesIn.delete(this)
      // is based on https://github.com/npm/cli/pull/8089.
      this.#safeTo?.deleteEdgeIn(this)
      this.#safeTo = (newTo as SafeNode) ?? null
      this.#safeError = null
      this.#safeTo?.addEdgeIn(this)
    } else if (hard) {
      this.#safeError = null
    }
    // Patch adding "else if" condition based on
    // https://github.com/npm/cli/pull/8089.
    else if (needToUpdateOverrideSet && this.#safeTo) {
      // Propagate the new override set to the target node.
      this.#safeTo.updateOverridesEdgeInRemoved(oldOverrideSet!)
      this.#safeTo.updateOverridesEdgeInAdded(newOverrideSet)
    }
  }

  override satisfiedBy(node: SafeNode) {
    // Patch replacing
    // if (node.name !== this.#name) {
    //   return false
    // }
    // is based on https://github.com/npm/cli/pull/8089.
    if (node.name !== this.name || !this.#safeFrom) {
      return false
    }
    // NOTE: this condition means we explicitly do not support overriding
    // bundled or shrinkwrapped dependencies
    if (node.hasShrinkwrap || node.inShrinkwrap || node.inBundle) {
      return depValid(node, this.rawSpec, this.accept, this.#safeFrom)
    }
    // Patch replacing
    // return depValid(node, this.spec, this.#accept, this.#from)
    // is based on https://github.com/npm/cli/pull/8089.
    //
    // If there's no override we just use the spec.
    if (!this.overrides?.keySpec) {
      return depValid(node, this.spec, this.accept, this.#safeFrom)
    }
    // There's some override. If the target node satisfies the overriding spec
    // then it's okay.
    if (depValid(node, this.spec, this.accept, this.#safeFrom)) {
      return true
    }
    // If it doesn't, then it should at least satisfy the original spec.
    if (!depValid(node, this.rawSpec, this.accept, this.#safeFrom)) {
      return false
    }
    // It satisfies the original spec, not the overriding spec. We need to make
    // sure it doesn't use the overridden spec.
    // For example:
    //   we might have an ^8.0.0 rawSpec, and an override that makes
    //   keySpec=8.23.0 and the override value spec=9.0.0.
    //   If the node is 9.0.0, then it's okay because it's consistent with spec.
    //   If the node is 8.24.0, then it's okay because it's consistent with the rawSpec.
    //   If the node is 8.23.0, then it's not okay because even though it's consistent
    //   with the rawSpec, it's also consistent with the keySpec.
    //   So we're looking for ^8.0.0 or 9.0.0 and not 8.23.0.
    return !depValid(node, this.overrides.keySpec, this.accept, this.#safeFrom)
  }
}
