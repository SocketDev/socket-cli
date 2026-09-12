import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

function repositoryPathSeparators(value: string): string {
  return value.replaceAll('\\', '/')
}

export function repositoryPathApi(value: string): typeof path.posix {
  // A drive prefix or UNC root selects Windows path semantics.
  return /^(?:[a-z]:[\\/]|\/\/|\\\\)/iu.test(value) ? path.win32 : path.posix
}

export function resolveRepositoryPath(base: string, value: string): string {
  const valueApi = repositoryPathApi(value)
  const api = valueApi === path.win32 ? valueApi : repositoryPathApi(base)
  return repositoryPathSeparators(
    api.resolve(base, repositoryPathSeparators(value)),
  )
}

export function containsRepositoryPath(root: string, target: string): boolean {
  const api = repositoryPathApi(root)
  const relative = repositoryPathSeparators(api.relative(root, target))
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith('../') &&
      !api.isAbsolute(relative))
  )
}

export function repositoryRealPath(value: string): string | undefined {
  const api = repositoryPathApi(value)
  let candidate = api.resolve(value)
  const missing: string[] = []
  while (true) {
    try {
      lstatSync(candidate)
      return repositoryPathSeparators(
        api.join(realpathSync(candidate), ...missing),
      )
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        return undefined
      }
      try {
        if (lstatSync(candidate).isSymbolicLink()) {
          return undefined
        }
      } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code !== 'ENOENT') {
          return undefined
        }
      }
      const parent = api.dirname(candidate)
      if (parent === candidate) {
        return undefined
      }
      missing.unshift(api.basename(candidate))
      candidate = parent
    }
  }
}

export function repositoryContainsTarget(
  root: string,
  target: string,
): boolean {
  const resolvedRoot = repositoryRealPath(root)
  const resolvedTarget = repositoryRealPath(target)
  if (
    resolvedRoot === undefined ||
    resolvedTarget === undefined ||
    !containsRepositoryPath(resolvedRoot, resolvedTarget)
  ) {
    return false
  }
  const nestedRoot =
    findRepositoryRoot(
      resolveRepositoryPath(resolvedTarget, '.boundary-root'),
    ) ?? findRepositoryRoot(resolvedTarget)
  if (nestedRoot && nestedRoot !== resolvedRoot) {
    return repositoryNestedCheckoutIsContained(resolvedRoot, nestedRoot)
  }
  return true
}

export function findRepositoryRoot(file: string): string | undefined {
  const api = repositoryPathApi(file)
  let directory = api.dirname(api.resolve(file))
  while (true) {
    try {
      lstatSync(api.join(directory, '.git'))
      return repositoryPathSeparators(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return undefined
      }
    }
    const parent = api.dirname(directory)
    if (parent === directory) {
      return undefined
    }
    directory = parent
  }
}

function repositoryNestedCheckoutIsContained(
  root: string,
  nestedRoot: string,
): boolean {
  try {
    const marker = path.join(nestedRoot, '.git')
    if (!lstatSync(marker).isFile()) {
      return true
    }
    const reference = readFileSync(marker, 'utf8').trim()
    if (!reference.startsWith('gitdir: ')) {
      return false
    }
    const metadata = repositoryRealPath(
      resolveRepositoryPath(nestedRoot, reference.slice(8)),
    )
    return (
      metadata !== undefined &&
      existsSync(metadata) &&
      repositoryMetadataIsContained(root, metadata) &&
      !existsSync(path.join(metadata, 'commondir'))
    )
  } catch {
    return false
  }
}

function repositoryMetadataIsContained(
  root: string,
  metadata: string,
): boolean {
  if (containsRepositoryPath(root, metadata)) {
    return true
  }
  const marker = path.join(root, '.git')
  if (!lstatSync(marker).isFile()) {
    return false
  }
  const reference = readFileSync(marker, 'utf8').trim()
  if (!reference.startsWith('gitdir: ')) {
    return false
  }
  const gitDirectory = repositoryRealPath(
    resolveRepositoryPath(root, reference.slice(8)),
  )
  if (!gitDirectory) {
    return false
  }
  if (containsRepositoryPath(path.join(gitDirectory, 'modules'), metadata)) {
    return true
  }
  const commonFile = path.join(gitDirectory, 'commondir')
  const commonDirectory = repositoryRealPath(
    resolveRepositoryPath(
      gitDirectory,
      readFileSync(commonFile, 'utf8').trim(),
    ),
  )
  return (
    commonDirectory !== undefined &&
    containsRepositoryPath(path.join(commonDirectory, 'modules'), metadata)
  )
}
