import npa from 'npm-package-arg'
import semver from 'semver'

import constants from '../../../constants'
import { arboristOverrideSetClassPath } from '../../npm-paths'
import { getLogger } from '../../proc-log'

import type { SafeEdge } from './edge'
import type { SafeNode } from './node'
import type { AliasResult, RegistryResult } from 'npm-package-arg'

const { LOOP_SENTINEL } = constants

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

const OverrideSet: OverrideSetClass = require(arboristOverrideSetClassPath)

// Implementation code not related to patch https://github.com/npm/cli/pull/7025
// is based on https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/override-set.js:
export class SafeOverrideSet extends OverrideSet {
  // Patch adding doOverrideSetsConflict is based on
  // https://github.com/npm/cli/pull/7025.
  static doOverrideSetsConflict(
    first: SafeOverrideSet | undefined,
    second: SafeOverrideSet | undefined
  ) {
    // If override sets contain one another then we can try to use the more specific
    // one. However, if neither one is more specific, then we consider them to be
    // in conflict.
    return this.findSpecificOverrideSet(first, second) === undefined
  }

  // Patch adding findSpecificOverrideSet is based on
  // https://github.com/npm/cli/pull/7025.
  static findSpecificOverrideSet(
    first: SafeOverrideSet | undefined,
    second: SafeOverrideSet | undefined
  ) {
    let overrideSet = second
    while (overrideSet) {
      if (overrideSet.isEqual(first)) {
        return second
      }
      overrideSet = overrideSet.parent
    }
    overrideSet = first
    while (overrideSet) {
      if (overrideSet.isEqual(second)) {
        return first
      }
      overrideSet = overrideSet.parent
    }
    // The override sets are incomparable. Neither one contains the other.
    const log = getLogger()
    log?.silly('Conflicting override sets', first, second)
    return undefined
  }

  // Patch adding childrenAreEqual is based on
  // https://github.com/npm/cli/pull/7025.
  override childrenAreEqual(otherOverrideSet: SafeOverrideSet): boolean {
    const queue: [SafeOverrideSet, SafeOverrideSet][] = [
      [this, otherOverrideSet]
    ]
    let pos = 0
    let { length: queueLength } = queue
    while (pos < queueLength) {
      if (pos === LOOP_SENTINEL) {
        throw new Error('Detected infinite loop while comparing override sets')
      }
      const { 0: currSet, 1: currOtherSet } = queue[pos++]!
      const { children } = currSet
      const { children: otherChildren } = currOtherSet
      if (children.size !== otherChildren.size) {
        return false
      }
      for (const key of children.keys()) {
        if (!otherChildren.has(key)) {
          return false
        }
        const child = children.get(key)!
        const otherChild = otherChildren.get(key)!
        if (child.value !== otherChild.value) {
          return false
        }
        queue[queueLength++] = [child, otherChild]
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
      // is based on https://github.com/npm/cli/pull/7025.
      //
      // We need to use the rawSpec here, because the spec has the overrides
      // applied to it already.
      let spec = npa(`${edge.name}@${edge.rawSpec}`)
      if (spec.type === 'alias') {
        spec = (<AliasResult>spec).subSpec
      }
      if (spec.type === 'git') {
        if (
          spec.gitRange &&
          rule.keySpec &&
          semver.intersects(spec.gitRange, rule.keySpec)
        ) {
          return rule
        }
        continue
      }
      if (spec.type === 'range' || spec.type === 'version') {
        if (
          rule.keySpec &&
          semver.intersects((<RegistryResult>spec).fetchSpec, rule.keySpec)
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
  // https://github.com/npm/cli/pull/7025.
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
