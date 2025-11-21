import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

export type ReachabilityTargetValidation = {
  isDirectory: boolean
  isInsideCwd: boolean
  isValid: boolean
  targetExists: boolean
}

/**
 * Validates that a target directory meets the requirements for reachability analysis.
 *
 * @param targets - Array of target paths to validate.
 * @param cwd - Current working directory.
 * @returns Validation result object with boolean flags.
 */
export async function validateReachabilityTarget(
  targets: string[],
  cwd: string,
): Promise<ReachabilityTargetValidation> {
  const result: ReachabilityTargetValidation = {
    isDirectory: false,
    isInsideCwd: false,
    isValid: targets.length === 1,
    targetExists: false,
  }

  if (!result.isValid || !targets[0]) {
    return result
  }

  // Resolve cwd to absolute path to handle relative cwd values.
  const absoluteCwd = path.resolve(cwd)

  // Resolve target path to absolute for validation.
  const targetPath = path.isAbsolute(targets[0])
    ? targets[0]
    : path.resolve(absoluteCwd, targets[0])

  // Check if target is inside cwd.
  const relativePath = path.relative(absoluteCwd, targetPath)
  result.isInsideCwd =
    !relativePath.startsWith('..') && !path.isAbsolute(relativePath)

  result.targetExists = existsSync(targetPath)
  if (result.targetExists) {
    const targetStat = await fs.stat(targetPath)
    result.isDirectory = targetStat.isDirectory()
  }

  return result
}
