export type ResolutionFailure = {
  coord: string
  // Build tool's own failure message (deepest cause; may be multi-line).
  // Classified on; first line shown by default, whole thing at --verbose.
  detail: string
  config: string
}

export type ResolutionReport = {
  failures: ResolutionFailure[]
  scannedConfigs: string[]
}
