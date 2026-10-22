export type ResolutionFailure = {
  coord: string
  // Build tool's own failure message (deepest cause; may be multi-line).
  // Classified on; first line shown by default, whole thing at --verbose.
  detail: string
  // Empty when the failed module is absent from the tool's resolved graph, so
  // no configuration holds it.
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
