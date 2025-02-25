import path from 'node:path'

import { parse as yamlParse } from 'yaml'

import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import constants from '../../constants.ts'
import { safeReadFile } from '../../utils/fs.ts'

import type { Agent } from '../../utils/package-manager-detector.ts'

type PackageJson = Awaited<ReturnType<typeof readPackageJson>>

const { PNPM } = constants

const PNPM_WORKSPACE = `${PNPM}-workspace`

export async function getWorkspaceGlobs(
  agent: Agent,
  pkgPath: string,
  pkgJson: PackageJson
): Promise<string[] | undefined> {
  let workspacePatterns
  if (agent === PNPM) {
    for (const workspacePath of [
      path.join(pkgPath, `${PNPM_WORKSPACE}.yaml`),
      path.join(pkgPath, `${PNPM_WORKSPACE}.yml`)
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const yml = <string | undefined>await safeReadFile(workspacePath, 'utf8')
      if (yml) {
        try {
          workspacePatterns = yamlParse(yml)?.packages
        } catch {}
        if (workspacePatterns) {
          break
        }
      }
    }
  } else {
    workspacePatterns = pkgJson['workspaces']
  }
  return Array.isArray(workspacePatterns)
    ? workspacePatterns
        .filter(isNonEmptyString)
        .map(workspacePatternToGlobPattern)
    : undefined
}

function workspacePatternToGlobPattern(workspace: string): string {
  const { length } = workspace
  if (!length) {
    return ''
  }
  // If the workspace ends with "/"
  if (workspace.charCodeAt(length - 1) === 47 /*'/'*/) {
    return `${workspace}/*/package.json`
  }
  // If the workspace ends with "/**"
  if (
    workspace.charCodeAt(length - 1) === 42 /*'*'*/ &&
    workspace.charCodeAt(length - 2) === 42 /*'*'*/ &&
    workspace.charCodeAt(length - 3) === 47 /*'/'*/
  ) {
    return `${workspace}/*/**/package.json`
  }
  // Things like "packages/a" or "packages/*"
  return `${workspace}/package.json`
}
