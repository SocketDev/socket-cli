export type ResolutionFailure = {
  coord: string
  // Build tool's own failure message (deepest cause; may be multi-line).
  // Classified on; first line shown by default, whole thing at --verbose.
  detail: string
  // Empty when the failure cannot be placed in a configuration; it then counts
  // against every configuration of its project.
  config: string
  // projectKey of the subproject being resolved.
  project: string
}

// A resolution that threw without naming a dependency: one configuration, or
// with an empty `config` the whole project.
export type Unscannable = {
  config: string
  detail: string
  project: string
}

export type ResolutionReport = {
  failures: ResolutionFailure[]
  scannedConfigs: string[]
  unscannable: Unscannable[]
}
