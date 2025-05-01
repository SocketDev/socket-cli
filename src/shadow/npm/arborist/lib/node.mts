import { createRequire } from 'node:module'

import semver from 'semver'

import { SafeOverrideSet } from './override-set.mts'
import { getArboristNodeClassPath } from '../../paths.mts'
import { getLogger } from '../../proc-log/index.mts'

import type { SafeEdge } from './edge.mts'
import type { Node as BaseNode, Link } from '@npmcli/arborist'

const require = createRequire(import.meta.url)

type NodeClass = Omit<
  BaseNode,
  | 'addEdgeIn'
  | 'addEdgeOut'
  | 'canDedupe'
  | 'canReplace'
  | 'canReplaceWith'
  | 'children'
  | 'deleteEdgeIn'
  | 'edgesIn'
  | 'edgesOut'
  | 'from'
  | 'hasShrinkwrap'
  | 'inDepBundle'
  | 'inShrinkwrap'
  | 'integrity'
  | 'isTop'
  | 'matches'
  | 'meta'
  | 'name'
  | 'overrides'
  | 'packageName'
  | 'parent'
  | 'recalculateOutEdgesOverrides'
  | 'resolve'
  | 'resolveParent'
  | 'root'
  | 'updateOverridesEdgeInAdded'
  | 'updateOverridesEdgeInRemoved'
  | 'version'
  | 'versions'
> & {
  name: string
  version: string
  children: Map<string, SafeNode | Link>
  edgesIn: Set<SafeEdge>
  edgesOut: Map<string, SafeEdge>
  from: SafeNode | null
  hasShrinkwrap: boolean
  inShrinkwrap: boolean | undefined
  integrity?: string | null
  isTop: boolean | undefined
  meta: BaseNode['meta'] & {
    addEdge(edge: SafeEdge): void
  }
  overrides: SafeOverrideSet | undefined
  versions: string[]
  get inDepBundle(): boolean
  get packageName(): string | null
  get parent(): SafeNode | null
  set parent(value: SafeNode | null)
  get resolveParent(): SafeNode | null
  get root(): SafeNode | null
  set root(value: SafeNode | null)
  new (...args: any): NodeClass
  addEdgeIn(edge: SafeEdge): void
  addEdgeOut(edge: SafeEdge): void
  canDedupe(preferDedupe?: boolean): boolean
  canReplace(node: SafeNode, ignorePeers?: string[]): boolean
  canReplaceWith(node: SafeNode, ignorePeers?: string[]): boolean
  deleteEdgeIn(edge: SafeEdge): void
  matches(node: SafeNode): boolean
  recalculateOutEdgesOverrides(): void
  resolve(name: string): SafeNode
  updateOverridesEdgeInAdded(
    otherOverrideSet: SafeOverrideSet | undefined
  ): boolean
  updateOverridesEdgeInRemoved(otherOverrideSet: SafeOverrideSet): boolean
}

const Node: NodeClass = require(getArboristNodeClassPath())

// Implementation code not related to patch https://github.com/npm/cli/pull/8089
// is based on https://github.com/npm/cli/blob/v11.0.0/workspaces/arborist/lib/node.js:
export class SafeNode extends Node {
  // Return true if it's safe to remove this node, because anything that is
  // depending on it would be fine with the thing that they would resolve to if
  // it was removed, or nothing is depending on it in the first place.
  override canDedupe(preferDedupe = false) {
    // Not allowed to mess with shrinkwraps or bundles.
    if (this.inDepBundle || this.inShrinkwrap) {
      return false
    }
    // It's a top level pkg, or a dep of one.
    if (!this.resolveParent?.resolveParent) {
      return false
    }
    // No one wants it, remove it.
    if (this.edgesIn.size === 0) {
      return true
    }
    const other = this.resolveParent.resolveParent.resolve(this.name)
    // Nothing else, need this one.
    if (!other) {
      return false
    }
    // If it's the same thing, then always fine to remove.
    if (other.matches(this)) {
      return true
    }
    // If the other thing can't replace this, then skip it.
    if (!other.canReplace(this)) {
      return false
    }
    // Patch replacing
    // if (preferDedupe || semver.gte(other.version, this.version)) {
    //   return true
    // }
    // is based on https://github.com/npm/cli/pull/8089.
    //
    // If we prefer dedupe, or if the version is equal, take the other.
    if (preferDedupe || semver.eq(other.version, this.version)) {
      return true
    }
    // If our current version isn't the result of an override, then prefer to
    // take the greater version.
    if (!this.overridden && semver.gt(other.version, this.version)) {
      return true
    }
    return false
  }

  // Is it safe to replace one node with another?  check the edges to
  // make sure no one will get upset.  Note that the node might end up
  // having its own unmet dependencies, if the new node has new deps.
  // Note that there are cases where Arborist will opt to insert a node
  // into the tree even though this function returns false!  This is
  // necessary when a root dependency is added or updated, or when a
  // root dependency brings peer deps along with it.  In that case, we
  // will go ahead and create the invalid state, and then try to resolve
  // it with more tree construction, because it's a user request.
  override canReplaceWith(node: SafeNode, ignorePeers?: string[]): boolean {
    if (this.name !== node.name || this.packageName !== node.packageName) {
      return false
    }
    // Patch replacing
    // if (node.overrides !== this.overrides) {
    //   return false
    // }
    // is based on https://github.com/npm/cli/pull/8089.
    //
    // If this node has no dependencies, then it's irrelevant to check the
    // override rules of the replacement node.
    if (this.edgesOut.size) {
      // XXX need to check for two root nodes?
      if (node.overrides) {
        if (!node.overrides.isEqual(this.overrides)) {
          return false
        }
      } else {
        if (this.overrides) {
          return false
        }
      }
    }
    // To satisfy the patch we ensure `node.overrides === this.overrides`
    // so that the condition we want to replace,
    // if (this.overrides !== node.overrides) {
    // , is not hit.`
    const oldOverrideSet = this.overrides
    let result = true
    if (oldOverrideSet !== node.overrides) {
      this.overrides = node.overrides
    }
    try {
      result = super.canReplaceWith(node, ignorePeers)
      this.overrides = oldOverrideSet
    } catch (e) {
      this.overrides = oldOverrideSet
      throw e
    }
    return result
  }

  // Patch adding deleteEdgeIn is based on https://github.com/npm/cli/pull/8089.
  override deleteEdgeIn(edge: SafeEdge) {
    this.edgesIn.delete(edge)
    const { overrides } = edge
    if (overrides) {
      this.updateOverridesEdgeInRemoved(overrides)
    }
  }

  override addEdgeIn(edge: SafeEdge): void {
    // Patch replacing
    // if (edge.overrides) {
    //   this.overrides = edge.overrides
    // }
    // is based on https://github.com/npm/cli/pull/8089.
    //
    // We need to handle the case where the new edge in has an overrides field
    // which is different from the current value.
    if (!this.overrides || !this.overrides.isEqual(edge.overrides)) {
      this.updateOverridesEdgeInAdded(edge.overrides)
    }
    this.edgesIn.add(edge)
    // Try to get metadata from the yarn.lock file.
    this.root.meta?.addEdge(edge)
  }

  // @ts-ignore: Incorrectly typed as a property instead of an accessor.
  override get overridden() {
    // Patch replacing
    // return !!(this.overrides && this.overrides.value && this.overrides.name === this.name)
    // is based on https://github.com/npm/cli/pull/8089.
    if (
      !this.overrides ||
      !this.overrides.value ||
      this.overrides.name !== this.name
    ) {
      return false
    }
    // The overrides rule is for a package with this name, but some override
    // rules only apply to specific versions. To make sure this package was
    // actually overridden, we check whether any edge going in had the rule
    // applied to it, in which case its overrides set is different than its
    // source node.
    for (const edge of this.edgesIn) {
      if (
        edge.overrides &&
        edge.overrides.name === this.name &&
        edge.overrides.value === this.version
      ) {
        if (!edge.overrides.isEqual(edge.from?.overrides)) {
          return true
        }
      }
    }
    return false
  }

  override set parent(newParent: SafeNode) {
    // Patch removing
    // if (parent.overrides) {
    //   this.overrides = parent.overrides.getNodeRule(this)
    // }
    // is based on https://github.com/npm/cli/pull/8089.
    //
    // The "parent" setter is a really large and complex function. To satisfy
    // the patch we hold on to the old overrides value and set `this.overrides`
    // to `undefined` so that the condition we want to remove is not hit.
    const { overrides } = this
    if (overrides) {
      this.overrides = undefined
    }
    try {
      super.parent = newParent
      this.overrides = overrides
    } catch (e) {
      this.overrides = overrides
      throw e
    }
  }

  // Patch adding recalculateOutEdgesOverrides is based on
  // https://github.com/npm/cli/pull/8089.
  override recalculateOutEdgesOverrides() {
    // For each edge out propagate the new overrides through.
    for (const edge of this.edgesOut.values()) {
      edge.reload(true)
      if (edge.to) {
        edge.to.updateOverridesEdgeInAdded(edge.overrides)
      }
    }
  }

  // @ts-ignore: Incorrectly typed to accept null.
  override set root(newRoot: SafeNode) {
    // Patch removing
    // if (!this.overrides && this.parent && this.parent.overrides) {
    //   this.overrides = this.parent.overrides.getNodeRule(this)
    // }
    // is based on https://github.com/npm/cli/pull/8089.
    //
    // The "root" setter is a really large and complex function. To satisfy the
    // patch we add a dummy value to `this.overrides` so that the condition we
    // want to remove is not hit.
    if (!this.overrides) {
      this.overrides = new SafeOverrideSet({ overrides: '' })
    }
    try {
      super.root = newRoot
      this.overrides = undefined
    } catch (e) {
      this.overrides = undefined
      throw e
    }
  }

  // Patch adding updateOverridesEdgeInAdded is based on
  // https://github.com/npm/cli/pull/7025.
  //
  // This logic isn't perfect either. When we have two edges in that have
  // different override sets, then we have to decide which set is correct. This
  // function assumes the more specific override set is applicable, so if we have
  // dependencies A->B->C and A->C and an override set that specifies what happens
  // for C under A->B, this will work even if the new A->C edge comes along and
  // tries to change the override set. The strictly correct logic is not to allow
  // two edges with different overrides to point to the same node, because even
  // if this node can satisfy both, one of its dependencies might need to be
  // different depending on the edge leading to it. However, this might cause a
  // lot of duplication, because the conflict in the dependencies might never
  // actually happen.
  override updateOverridesEdgeInAdded(
    otherOverrideSet: SafeOverrideSet | undefined
  ) {
    if (!otherOverrideSet) {
      // Assuming there are any overrides at all, the overrides field is never
      // undefined for any node at the end state of the tree. So if the new edge's
      // overrides is undefined it will be updated later. So we can wait with
      // updating the node's overrides field.
      return false
    }
    if (!this.overrides) {
      this.overrides = otherOverrideSet
      this.recalculateOutEdgesOverrides()
      return true
    }
    if (this.overrides.isEqual(otherOverrideSet)) {
      return false
    }
    const newOverrideSet = SafeOverrideSet.findSpecificOverrideSet(
      this.overrides,
      otherOverrideSet
    )
    if (newOverrideSet) {
      if (this.overrides.isEqual(newOverrideSet)) {
        return false
      }
      this.overrides = newOverrideSet
      this.recalculateOutEdgesOverrides()
      return true
    }
    // This is an error condition. We can only get here if the new override set
    // is in conflict with the existing.
    const log = getLogger()
    log?.silly('Conflicting override sets', this.name)
    return false
  }

  // Patch adding updateOverridesEdgeInRemoved is based on
  // https://github.com/npm/cli/pull/7025.
  override updateOverridesEdgeInRemoved(otherOverrideSet: SafeOverrideSet) {
    // If this edge's overrides isn't equal to this node's overrides,
    // then removing it won't change newOverrideSet later.
    if (!this.overrides || !this.overrides.isEqual(otherOverrideSet)) {
      return false
    }
    let newOverrideSet
    for (const edge of this.edgesIn) {
      const { overrides: edgeOverrides } = edge
      if (newOverrideSet && edgeOverrides) {
        newOverrideSet = SafeOverrideSet.findSpecificOverrideSet(
          edgeOverrides,
          newOverrideSet
        )
      } else {
        newOverrideSet = edgeOverrides
      }
    }
    if (this.overrides.isEqual(newOverrideSet)) {
      return false
    }
    this.overrides = newOverrideSet
    if (newOverrideSet) {
      // Optimization: If there's any override set at all, then no non-extraneous
      // node has an empty override set. So if we temporarily have no override set
      // (for example, we removed all the edges in), there's no use updating all
      // the edges out right now. Let's just wait until we have an actual override
      // set later.
      this.recalculateOutEdgesOverrides()
    }
    return true
  }
}
