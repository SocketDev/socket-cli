export type ResolutionFailure = {
  coord: string
  // Build tool's own failure message (deepest cause; may be multi-line).
  // Classified on; first line shown by default, whole thing at --verbose.
  detail: string
  config: string
}

// A whole config whose resolution threw, vs a single unresolved dep (`ResolutionFailure`).
export type UnscannableConfig = {
  config: string
  detail: string
}

export type ResolutionReport = {
  failures: ResolutionFailure[]
  scannedConfigs: string[]
  // Which configs each first-party project resolved, for attribution when the
  // flat scannedConfigs union spans projects with different configs (common
  // for dotnet, where every project picks its own target frameworks).
  configsByProject: Array<{ project: string; configs: string[] }>
  unscannable: UnscannableConfig[]
}
