/*
 * @file Read the repo's catalog block twice — as committed at `HEAD`, and as it
 *   stands in the working tree — so a gate can compare the two and see which
 *   direction a pin moved. Split out from the check that uses it so the pure
 *   comparison stays unit-testable without a git fixture.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { PNPM_WORKSPACE_YAML, REPO_ROOT } from '../paths.mts'
import { parseCatalogBlock } from './workspace-yaml.mts'

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
  const rel = path.relative(repoRoot, PNPM_WORKSPACE_YAML)
  try {
    const result = await spawn('git', ['show', `HEAD:${rel}`], {
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
 * The committed and working-tree catalogs, or undefined when either side is
 * unavailable.
 */
export async function catalogsForDowngradeCheck(
  repoRoot: string = REPO_ROOT,
): Promise<CatalogPair | undefined> {
  if (!existsSync(PNPM_WORKSPACE_YAML)) {
    return undefined
  }
  const committedYaml = await committedWorkspaceYaml(repoRoot)
  if (committedYaml === undefined) {
    return undefined
  }
  return {
    committed: toMap(parseCatalogBlock(committedYaml)),
    proposed: toMap(
      parseCatalogBlock(readFileSync(PNPM_WORKSPACE_YAML, 'utf8')),
    ),
  }
}
