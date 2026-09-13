import type {
  PatternRule,
  PatternSeverity,
  ScannerName,
} from '@socketsecurity/scan-patterns'

export interface ScannerPatternFinding {
  category: string
  column: number
  description: string
  file: string
  line: number
  ruleId: string
  severity: PatternSeverity
  title: string
}

export interface ScannerPatternResult {
  filesScanned: number
  findings: ScannerPatternFinding[]
  scanner: ScannerName
  unsupportedRules: ScannerPatternUnsupportedRule[]
}

export interface ScannerPatternScanOptions {
  cwd?: string | undefined
  minimumSeverity?: PatternSeverity | undefined
}

export interface ScannerPatternUnsupportedRule {
  dialect: PatternRule['dialect']
  id: string
  kind: PatternRule['kind']
  title: string
}
