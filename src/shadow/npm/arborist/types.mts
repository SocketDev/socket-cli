import { createEnum } from '../../../utils/objects.mts'

import type {
  Advisory as BaseAdvisory,
  Arborist as BaseArborist,
  Options as BaseArboristOptions,
  AuditReport as BaseAuditReport,
  Diff as BaseDiff,
  Edge as BaseEdge,
  Node as BaseNode,
  BaseOverrideSet,
  BuildIdealTreeOptions,
  ReifyOptions,
} from '@npmcli/arborist'

export type ArboristOptions = BaseArboristOptions & {
  npmCommand?: string
  npmVersion?: string
}

export type ArboristClass = ArboristInstance & {
  new (...args: any): ArboristInstance
}

export type ArboristInstance = Omit<
  typeof BaseArborist,
  | 'actualTree'
  | 'auditReport'
  | 'buildIdealTree'
  | 'diff'
  | 'idealTree'
  | 'loadActual'
  | 'loadVirtual'
  | 'reify'
> & {
  auditReport?: AuditReportInstance | null | undefined
  actualTree?: NodeClass | null | undefined
  diff: Diff | null
  idealTree?: NodeClass | null | undefined
  buildIdealTree(options?: BuildIdealTreeOptions): Promise<NodeClass>
  loadActual(options?: ArboristOptions): Promise<NodeClass>
  loadVirtual(options?: ArboristOptions): Promise<NodeClass>
  reify(options?: ArboristReifyOptions): Promise<NodeClass>
}

export type ArboristReifyOptions = ReifyOptions & ArboristOptions

export type AuditAdvisory = Omit<BaseAdvisory, 'id'> & {
  id: number
  cwe: string[]
  cvss: {
    score: number
    vectorString: string
  }
  vulnerable_versions: string
}

export type AuditReportInstance = Omit<BaseAuditReport, 'report'> & {
  report: { [dependency: string]: AuditAdvisory[] }
}

export const DiffAction = createEnum({
  add: 'ADD',
  change: 'CHANGE',
  remove: 'REMOVE',
})

export type Diff = Omit<
  BaseDiff,
  | 'actual'
  | 'children'
  | 'filterSet'
  | 'ideal'
  | 'leaves'
  | 'removed'
  | 'shrinkwrapInflated'
  | 'unchanged'
> & {
  actual: NodeClass
  children: Diff[]
  filterSet: Set<NodeClass>
  ideal: NodeClass
  leaves: NodeClass[]
  parent: Diff | null
  removed: NodeClass[]
  shrinkwrapInflated: Set<NodeClass>
  unchanged: NodeClass[]
}

export type EdgeClass = Omit<
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
  overrides: OverrideSetClass | undefined
  peer: boolean
  peerConflicted: boolean
  rawSpec: string
  get accept(): string | undefined
  get spec(): string
  get to(): NodeClass | null
  new (...args: any): EdgeClass
  detach(): void
  reload(hard?: boolean): void
  satisfiedBy(node: NodeClass): boolean
}

export type LinkClass = Omit<NodeClass, 'isLink'> & {
  readonly isLink: true
}

export type NodeClass = Omit<
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
  | 'target'
  | 'updateOverridesEdgeInAdded'
  | 'updateOverridesEdgeInRemoved'
  | 'version'
  | 'versions'
> & {
  name: string
  version: string
  children: Map<string, NodeClass | LinkClass>
  edgesIn: Set<EdgeClass>
  edgesOut: Map<string, EdgeClass>
  from: NodeClass | null
  hasShrinkwrap: boolean
  inShrinkwrap: boolean | undefined
  integrity?: string | null
  isTop: boolean | undefined
  meta: BaseNode['meta'] & {
    addEdge(edge: EdgeClass): void
  }
  overrides: OverrideSetClass | undefined
  target: NodeClass
  versions: string[]
  get inDepBundle(): boolean
  get packageName(): string | null
  get parent(): NodeClass | null
  set parent(value: NodeClass | null)
  get resolveParent(): NodeClass | null
  get root(): NodeClass | null
  set root(value: NodeClass | null)
  new (...args: any): NodeClass
  addEdgeIn(edge: EdgeClass): void
  addEdgeOut(edge: EdgeClass): void
  canDedupe(preferDedupe?: boolean): boolean
  canReplace(node: NodeClass, ignorePeers?: string[]): boolean
  canReplaceWith(node: NodeClass, ignorePeers?: string[]): boolean
  deleteEdgeIn(edge: EdgeClass): void
  matches(node: NodeClass): boolean
  recalculateOutEdgesOverrides(): void
  resolve(name: string): NodeClass
  updateOverridesEdgeInAdded(
    otherOverrideSet: OverrideSetClass | undefined,
  ): boolean
  updateOverridesEdgeInRemoved(otherOverrideSet: OverrideSetClass): boolean
}

export interface OverrideSetClass
  extends Omit<
    BaseOverrideSet,
    | 'ancestry'
    | 'children'
    | 'getEdgeRule'
    | 'getMatchingRule'
    | 'getNodeRule'
    | 'parent'
    | 'ruleset'
  > {
  children: Map<string, OverrideSetClass>
  key: string | undefined
  keySpec: string | undefined
  name: string | undefined
  parent: OverrideSetClass | undefined
  value: string | undefined
  version: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-misused-new
  new (...args: any[]): OverrideSetClass
  get isRoot(): boolean
  get ruleset(): Map<string, OverrideSetClass>
  ancestry(): Generator<OverrideSetClass>
  childrenAreEqual(otherOverrideSet: OverrideSetClass | undefined): boolean
  getEdgeRule(edge: EdgeClass): OverrideSetClass
  getMatchingRule(node: NodeClass): OverrideSetClass | null
  getNodeRule(node: NodeClass): OverrideSetClass
  isEqual(otherOverrideSet: OverrideSetClass | undefined): boolean
}
