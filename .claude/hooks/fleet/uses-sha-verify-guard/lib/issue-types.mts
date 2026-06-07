// Shared issue shape across the four scan surfaces. The discriminant
// is implicit (callers know which finder produced which); explicit
// tagging adds noise without a real use case.

export interface UsesIssue {
  line: number
  raw: string
  problem: string
}

export interface SubmoduleIssue {
  submodule: string
  line: number
  problem: string
}

export interface PackageJsonIssue {
  ownerRepo: string
  ref: string
  problem: string
}

export interface BareUsesScanResult {
  issues: UsesIssue[]
  // SHAs already validated by this pass — the lone-SHA pass should
  // skip them to avoid re-verifying the same 40-char hex against
  // every targeted owner/repo (N×M gh api hammer).
  scannedShas: Set<string>
}
