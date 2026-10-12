import { existsSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sourceRoot = realpathSync(
  fileURLToPath(new URL('../../../../src/', import.meta.url)),
)

function isWithinSourceRoot(filePath: string): boolean {
  const relativePath = path.relative(sourceRoot, filePath)
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  )
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentURL = context.parentURL
    if (
      !parentURL?.startsWith('file:') ||
      !specifier.startsWith('.') ||
      !specifier.endsWith('.mjs')
    ) {
      return nextResolve(specifier, context)
    }

    const parentPath = realpathSync(fileURLToPath(parentURL))
    if (!isWithinSourceRoot(parentPath)) {
      return nextResolve(specifier, context)
    }

    const requestedPath = fileURLToPath(new URL(specifier, parentURL))
    if (existsSync(requestedPath)) {
      return nextResolve(specifier, context)
    }

    const candidatePath = `${requestedPath.slice(0, -'.mjs'.length)}.mts`
    if (!existsSync(candidatePath)) {
      return nextResolve(specifier, context)
    }

    const candidateRealPath = realpathSync(candidatePath)
    if (
      !isWithinSourceRoot(candidateRealPath) ||
      !statSync(candidateRealPath).isFile()
    ) {
      return nextResolve(specifier, context)
    }

    return nextResolve(pathToFileURL(candidateRealPath).href, context)
  },
})
