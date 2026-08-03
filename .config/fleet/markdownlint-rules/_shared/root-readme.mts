/**
 * @file Cross-platform repo-root README detection shared by markdownlint
 *   rules. markdownlint may report a relative path or an absolute path whose
 *   separators differ from the host cwd representation, so compare normalized
 *   strings instead of applying host-only basename/dirname operations.
 */

import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

export function isRootReadme(
  filePath: string | undefined,
  cwd = process.cwd(),
) {
  if (!filePath) {
    return false
  }
  const normalizedFilePath = normalizePath(filePath)
  if (
    normalizedFilePath === './README.md' ||
    normalizedFilePath === 'README.md'
  ) {
    return true
  }
  const normalizedCwd = normalizePath(cwd).replace(/\/+$/, '')
  return normalizedFilePath === `${normalizedCwd}/README.md`
}
