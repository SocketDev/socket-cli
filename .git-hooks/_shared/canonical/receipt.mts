/**
 * @file Validate runtime-only recipes for reproducible signed template deltas.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { canonicalHunksAreValid } from './patch.mts'
import {
  canonicalGitText,
  canonicalPathIsSafe,
  readCanonicalGit,
} from './git.mts'
import type { CanonicalGitRead } from './git.mts'

export interface CanonicalPatchStep {
  commit: string
  sourcePath: string
  targetPath: string
  hunks?: number[] | undefined
  application?: 'unique-replacement' | undefined
}
export interface CanonicalPatchRecipe {
  version: 1
  memberHead: string
  producerRoot: string
  patches: CanonicalPatchStep[]
}
// Accept immutable SHA-1 or SHA-256 object IDs only.
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u
function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function validStep(value: unknown): value is CanonicalPatchStep {
  const record = recordValue(value)
  if (
    record?.['application'] !== undefined &&
    record['application'] !== 'unique-replacement'
  ) {
    return false
  }
  if (
    record?.['hunks'] !== undefined &&
    !canonicalHunksAreValid(record['hunks'])
  ) {
    return false
  }
  return Boolean(
    record &&
    typeof record['commit'] === 'string' &&
    SHA_PATTERN.test(record['commit']) &&
    typeof record['sourcePath'] === 'string' &&
    canonicalPathIsSafe(record['sourcePath']) &&
    typeof record['targetPath'] === 'string' &&
    canonicalPathIsSafe(record['targetPath']) &&
    record['sourcePath'].endsWith(`/${record['targetPath']}`),
  )
}
export function validateCanonicalRecipe(
  value: unknown,
): CanonicalPatchRecipe | undefined {
  const record = recordValue(value)
  if (
    !record ||
    record['version'] !== 1 ||
    typeof record['memberHead'] !== 'string' ||
    !SHA_PATTERN.test(record['memberHead'])
  ) {
    return undefined
  }
  if (
    typeof record['producerRoot'] !== 'string' ||
    !path.isAbsolute(record['producerRoot']) ||
    record['producerRoot'].includes('\0')
  ) {
    return undefined
  }
  if (
    !Array.isArray(record['patches']) ||
    record['patches'].length === 0 ||
    record['patches'].length > 64 ||
    !record['patches'].every(validStep)
  ) {
    return undefined
  }
  return record as unknown as CanonicalPatchRecipe
}
export function canonicalReceiptPath(
  root: string,
  readGit: CanonicalGitRead = readCanonicalGit,
): string | undefined {
  const relative = canonicalGitText(
    root,
    ['rev-parse', '--git-path', 'fleet/canonical-patch-receipt.json'],
    readGit,
  )?.trim()
  return relative ? path.resolve(root, relative) : undefined
}
export function readCanonicalReceipt(
  root: string,
): CanonicalPatchRecipe | undefined {
  const receipt = canonicalReceiptPath(root)
  if (!receipt) {
    return undefined
  }
  try {
    const bytes = readFileSync(receipt)
    return bytes.length <= 65_536
      ? validateCanonicalRecipe(JSON.parse(bytes.toString('utf8')))
      : undefined
  } catch {
    return undefined
  }
}
