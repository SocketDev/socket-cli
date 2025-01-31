import type { SafeNode } from '../node'
import type {
  Options as ArboristOptions,
  Advisory as BaseAdvisory,
  Arborist as BaseArborist,
  AuditReport as BaseAuditReport,
  Diff as BaseDiff,
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
  diff: Diff | null
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
  actual: SafeNode
  children: Diff[]
  filterSet: Set<SafeNode>
  ideal: SafeNode
  leaves: SafeNode[]
  parent: Diff | null
  removed: SafeNode[]
  shrinkwrapInflated: Set<SafeNode>
  unchanged: SafeNode[]
}
