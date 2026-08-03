/*
 * @file Read a repo's catalog block twice — as committed at `HEAD`, and as it
 *   stands in the working tree — so a gate can compare the two and see which
 *   direction a pin moved. Split out from the check that uses it so the pure
 *   comparison stays unit-testable without a git fixture.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { parseCatalogBlock } from './workspace-yaml.mts'

// Repo-relative, so both sides of the comparison — the git read and the
// working-tree read — are anchored on the SAME root. Anchoring one on a shared
// absolute constant and the other on the caller's root silently compares one
// repo's HEAD against another repo's tree.
const WORKSPACE_REL = 'pnpm-workspace.yaml'

export interface CatalogPair {
  readonly committed: ReadonlyMap<string, string>
  readonly proposed: ReadonlyMap<string, string>
}

function toMap(record: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(record))
}

/**
 * The workspace file's contents at `HEAD`, or undefined when git can't produce
 * them — no repo, no commit yet, or the file is untracked. Undefined means
 * "nothing to compare", never "no downgrade".
 */
export async function committedWorkspaceYaml(
  repoRoot: string,
): Promise<string | undefined> {
  try {
    const result = await spawn('git', ['show', `HEAD:${WORKSPACE_REL}`], {
      cwd: repoRoot,
    })
    if (result.code !== 0 || typeof result.stdout !== 'string') {
      return undefined
    }
    return result.stdout
  } catch {
    return undefined
  }
}

/**
 * The committed and working-tree catalogs for `repoRoot`, or undefined when
 * either side is unavailable.
 */
export async function catalogsForDowngradeCheck(
  repoRoot: string = REPO_ROOT,
): Promise<CatalogPair | undefined> {
  const workspacePath = path.join(repoRoot, WORKSPACE_REL)
  if (!existsSync(workspacePath)) {
    return undefined
  }
  const committedYaml = await committedWorkspaceYaml(repoRoot)
  if (committedYaml === undefined) {
    return undefined
  }
  return {
    committed: toMap(parseCatalogBlock(committedYaml)),
    proposed: toMap(parseCatalogBlock(readFileSync(workspacePath, 'utf8'))),
  }
}
