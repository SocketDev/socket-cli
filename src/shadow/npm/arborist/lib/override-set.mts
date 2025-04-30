import { createRequire } from 'node:module'

import npa from 'npm-package-arg'
import semver from 'semver'

import { getArboristOverrideSetClassPath } from '../../paths.mts'
import { getLogger } from '../../proc-log/index.mts'

import type { SafeEdge } from './edge.mts'
import type { SafeNode } from './node.mts'
import type { AliasResult, RegistryResult } from 'npm-package-arg'

const require = createRequire(import.meta.url)

interface OverrideSetClass {
  children: Map<string, SafeOverrideSet>
  key: string | undefined
  keySpec: string | undefined
  name: string | undefined
  parent: SafeOverrideSet | undefined
  value: string | undefined
  version: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-misused-new
  new (...args: any[]): OverrideSetClass
  get isRoot(): boolean
  get ruleset(): Map<string, SafeOverrideSet>
  ancestry(): Generator<SafeOverrideSet>
  childrenAreEqual(otherOverrideSet: SafeOverrideSet | undefined): boolean
  getEdgeRule(edge: SafeEdge): SafeOverrideSet
  getNodeRule(node: SafeNode): SafeOverrideSet
  getMatchingRule(node: SafeNode): SafeOverrideSet | null
  isEqual(otherOverrideSet: SafeOverrideSet | undefined): boolean
}

const OverrideSet: OverrideSetClass = require(getArboristOverrideSetClassPath())

// Implementation code not related to patch https://github.com/npm/cli/pull/8089
// is based on https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/override-set.js:
export class SafeOverrideSet extends OverrideSet {
  // Patch adding doOverrideSetsConflict is based on
  // https://github.com/npm/cli/pull/8089.
  static doOverrideSetsConflict(
    first: SafeOverrideSet | undefined,
    second: SafeOverrideSet | undefined
  ) {
    // If override sets contain one another then we can try to use the more
    // specific one. If neither one is more specific, then we consider them to
    // be in conflict.
    return this.findSpecificOverrideSet(first, second) === undefined
  }

  // Patch adding findSpecificOverrideSet is based on
  // https://github.com/npm/cli/pull/8089.
  static findSpecificOverrideSet(
    first: SafeOverrideSet | undefined,
    second: SafeOverrideSet | undefined
  ) {
    for (
      let overrideSet = second;
      overrideSet;
      overrideSet = overrideSet.parent
    ) {
      if (overrideSet.isEqual(first)) {
        return second
      }
    }
    for (
      let overrideSet = first;
      overrideSet;
      overrideSet = overrideSet.parent
    ) {
      if (overrideSet.isEqual(second)) {
        return first
      }
    }
    // The override sets are incomparable. Neither one contains the other.
    const log = getLogger()
    log?.silly('Conflicting override sets', first, second)
    return undefined
  }

  // Patch adding childrenAreEqual is based on
  // https://github.com/npm/cli/pull/8089.
  override childrenAreEqual(otherOverrideSet: SafeOverrideSet) {
    if (this.children.size !== otherOverrideSet.children.size) {
      return false
    }
    for (const { 0: key, 1: childOverrideSet } of this.children) {
      const otherChildOverrideSet = otherOverrideSet.children.get(key)
      if (!otherChildOverrideSet) {
        return false
      }
      if (childOverrideSet.value !== otherChildOverrideSet.value) {
        return false
      }
      if (!childOverrideSet.childrenAreEqual(otherChildOverrideSet)) {
        return false
      }
    }
    return true
  }

  override getEdgeRule(edge: SafeEdge): SafeOverrideSet {
    for (const rule of this.ruleset.values()) {
      if (rule.name !== edge.name) {
        continue
      }
      // If keySpec is * we found our override.
      if (rule.keySpec === '*') {
        return rule
      }
      // Patch replacing
      // let spec = npa(`${edge.name}@${edge.spec}`)
      // is based on https://github.com/npm/cli/pull/8089.
      //
      // We need to use the rawSpec here, because the spec has the overrides
      // applied to it already. The rawSpec can be undefined, so we need to use
      // the fallback value of spec if it is.
      let spec = npa(`${edge.name}@${edge.rawSpec || edge.spec}`)
      if (spec.type === 'alias') {
        spec = (spec as AliasResult).subSpec
      }
      if (spec.type === 'git') {
        if (spec.gitRange && semver.intersects(spec.gitRange, rule.keySpec!)) {
          return rule
        }
        continue
      }
      if (spec.type === 'range' || spec.type === 'version') {
        if (
          semver.intersects((spec as RegistryResult).fetchSpec, rule.keySpec!)
        ) {
          return rule
        }
        continue
      }
      // If we got this far, the spec type is one of tag, directory or file
      // which means we have no real way to make version comparisons, so we
      // just accept the override.
      return rule
    }
    return this
  }

  // Patch adding isEqual is based on
  // https://github.com/npm/cli/pull/8089.
  override isEqual(otherOverrideSet: SafeOverrideSet | undefined): boolean {
    if (this === otherOverrideSet) {
      return true
    }
    if (!otherOverrideSet) {
      return false
    }
    if (
      this.key !== otherOverrideSet.key ||
      this.value !== otherOverrideSet.value
    ) {
      return false
    }
    if (!this.childrenAreEqual(otherOverrideSet)) {
      return false
    }
    if (!this.parent) {
      return !otherOverrideSet.parent
    }
    return this.parent.isEqual(otherOverrideSet.parent)
  }
}
