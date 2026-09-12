/**
 * @file Read immutable Git blobs and the caller's active stage-zero index.
 */
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { GIT_CONTEXT_VARS } from '../git-context-vars.mts'

export interface CanonicalGitOptions {
  input?: Uint8Array | undefined
  preserveIndex?: boolean | undefined
}
export interface CanonicalGitResult {
  status: number
  stdout: Uint8Array
}
export type CanonicalGitRead = (
  root: string,
  args: readonly string[],
  options?: CanonicalGitOptions | undefined,
) => CanonicalGitResult
export interface CanonicalIndexEntry {
  mode: string
  oid: string
  content: Uint8Array
}

export function readCanonicalGit(
  root: string,
  args: readonly string[],
  options: CanonicalGitOptions = {},
): CanonicalGitResult {
  const env = { ...process.env }
  for (let i = 0, { length } = GIT_CONTEXT_VARS; i < length; i += 1) {
    const name = GIT_CONTEXT_VARS[i]!
    if (name !== 'GIT_INDEX_FILE' || !options.preserveIndex) {
      delete env[name]
    }
  }
  const result = spawnSync(
    'git',
    ['--no-replace-objects', '--literal-pathspecs', ...args],
    {
      cwd: root,
      encoding: 'buffer',
      env,
      input: options.input,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      maxBuffer: 4_194_304,
    },
  )
  return {
    status: result.status ?? 1,
    stdout: Buffer.isBuffer(result.stdout)
      ? result.stdout
      : Buffer.from(result.stdout ?? ''),
  }
}

export function canonicalGitText(
  root: string,
  args: readonly string[],
  readGit: CanonicalGitRead = readCanonicalGit,
): string | undefined {
  const result = readGit(root, args)
  return result.status === 0
    ? Buffer.from(result.stdout).toString('utf8')
    : undefined
}

export function canonicalPathIsSafe(file: string): boolean {
  const normalized = normalizePath(file)
  return (
    file === normalized &&
    file.length > 0 &&
    file.length < 1024 &&
    !normalized.startsWith('/') &&
    !normalized.includes('\\') &&
    !/[\x00-\x1f\x7f:]/u.test(file) &&
    normalizePath(file)
      .split('/')
      .every(
        part =>
          part !== '' &&
          part !== '.' &&
          part !== '..' &&
          part.toLowerCase() !== '.git',
      )
  )
}

function readBlobEntry(
  root: string,
  oid: string,
  mode: string,
  readGit: CanonicalGitRead,
): CanonicalIndexEntry | undefined {
  if (!['100644', '100755'].includes(mode)) {
    return undefined
  }
  const result = readGit(root, ['cat-file', 'blob', oid])
  return result.status === 0 ? { mode, oid, content: result.stdout } : undefined
}

export function readCanonicalIndexEntry(
  root: string,
  file: string,
  readGit: CanonicalGitRead = readCanonicalGit,
): CanonicalIndexEntry | undefined {
  if (!canonicalPathIsSafe(file)) {
    return undefined
  }
  const result = readGit(root, ['ls-files', '--stage', '-z', '--', file], {
    preserveIndex: true,
  })
  if (result.status !== 0) {
    return undefined
  }
  // A single stage-zero regular blob, with its exact NUL-terminated path.
  const match =
    /^(100644|100755) ((?:[a-f0-9]{40}|[a-f0-9]{64})) 0\t([^\0]+)\0$/u.exec(
      Buffer.from(result.stdout).toString('utf8'),
    )
  return match?.[3] === file
    ? readBlobEntry(root, match[2]!, match[1]!, readGit)
    : undefined
}

export function readCanonicalTreeEntry(
  root: string,
  ref: string,
  file: string,
  readGit: CanonicalGitRead = readCanonicalGit,
): CanonicalIndexEntry | undefined {
  if (!canonicalPathIsSafe(file)) {
    return undefined
  }
  const text = canonicalGitText(
    root,
    ['ls-tree', '-z', ref, '--', file],
    readGit,
  )
  if (text === undefined) {
    return undefined
  }
  // A single regular tree blob, with its exact NUL-terminated path.
  const match =
    /^(100644|100755) blob ((?:[a-f0-9]{40}|[a-f0-9]{64}))\t([^\0]+)\0$/u.exec(
      text,
    )
  return match?.[3] === file
    ? readBlobEntry(root, match[2]!, match[1]!, readGit)
    : undefined
}

export function canonicalEntriesEqual(
  left: CanonicalIndexEntry,
  right: CanonicalIndexEntry,
): boolean {
  return (
    left.mode === right.mode && Buffer.from(left.content).equals(right.content)
  )
}
