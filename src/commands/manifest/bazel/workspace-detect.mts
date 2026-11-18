import { existsSync } from 'node:fs'
import path from 'node:path'

import { InputError } from '../../../utils/errors.mts'

export type WorkspaceMode = {
  bzlmod: boolean
  workspace: boolean
}

// Detects whether the given Bazel workspace uses Bzlmod (MODULE.bazel),
// legacy WORKSPACE (WORKSPACE or WORKSPACE.bazel), or both (migration).
// Throws InputError when neither marker file is present.
export function detectWorkspaceMode(cwd: string): WorkspaceMode {
  const moduleBazel = existsSync(path.join(cwd, 'MODULE.bazel'))
  const workspaceFile =
    existsSync(path.join(cwd, 'WORKSPACE')) ||
    existsSync(path.join(cwd, 'WORKSPACE.bazel'))

  if (!moduleBazel && !workspaceFile) {
    throw new InputError(
      `No Bazel workspace found at ${cwd} (looked for MODULE.bazel, WORKSPACE, WORKSPACE.bazel).`,
    )
  }

  return { bzlmod: moduleBazel, workspace: workspaceFile }
}

// Returns the bazel CLI flags needed to invoke the correct workspace mode.
// Bzlmod-only or migration-window: rely on Bazel 7+ default (Bzlmod on).
// Legacy-only: explicitly disable Bzlmod and enable WORKSPACE.
export function getBazelInvocationFlags(mode: WorkspaceMode): string[] {
  if (mode.bzlmod) {
    // Bzlmod-only or migration: Bzlmod wins; no flags needed (Bazel 7+ default).
    return []
  }
  // Legacy-only: explicitly switch to WORKSPACE mode.
  return ['--noenable_bzlmod', '--enable_workspace']
}
