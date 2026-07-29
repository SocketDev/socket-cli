/**
 * Shared fixtures + factory helpers for the Maven extraction orchestrator
 * test files. The vi.mock preambles cannot be shared (vi.mock is hoisted
 * per test file), but the pure data helpers can.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type {
  CqueryRepoResult,
  ExtractedArtifact,
} from '../../../../../src/commands/manifest/bazel/bazel-cquery.mts'

export function readManifest(out: string, ...rel: string[]): unknown {
  return JSON.parse(
    readFileSync(
      path.join(out, '.socket-auto-manifest', ...rel, 'maven_install.json'),
      'utf8',
    ),
  )
}

export function readNamedManifest(
  out: string,
  fileName: string,
  ...rel: string[]
): unknown {
  return JSON.parse(
    readFileSync(
      path.join(out, '.socket-auto-manifest', ...rel, fileName),
      'utf8',
    ),
  )
}

export function mkResult(over: Partial<CqueryRepoResult>): CqueryRepoResult {
  return {
    artifacts: [],
    durationMs: 0,
    repoName: 'maven',
    status: 'ok',
    stderr: '',
    unresolvedLabels: [],
    workspaceRelPath: '',
    ...over,
  }
}

export function mkArt(
  coord: string,
  ruleName: string,
  over: Partial<ExtractedArtifact> = {},
): ExtractedArtifact {
  return {
    deps: [],
    mavenCoordinates: coord,
    ruleKind: 'jvm_import',
    ruleName,
    sourceRepo: 'maven',
    ...over,
  }
}

export const SHOW_EXT_HUB_ONLY = `## @@rules_jvm_external+//:extensions.bzl%maven:

Fetched repositories:
  - maven (imported by <root>)
`

// A probe result for a repo name that is not defined in the workspace.
export const PROBE_NOT_DEFINED = {
  code: 1,
  stderr: "ERROR: No repository visible as '@x' from main repository\n",
  stdout: '',
}
