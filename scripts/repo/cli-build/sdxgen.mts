import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export function getSdxgenAssetCopies(
  entryPath: string,
  outputPath: string,
): ReadonlyArray<readonly [string, string]> {
  const packagePath = path.dirname(path.dirname(entryPath))
  const distPath = path.join(packagePath, 'dist')
  return [
    [
      path.join(distPath, 'acorn-bindgen.cjs'),
      path.join(outputPath, 'acorn-bindgen.cjs'),
    ],
    [path.join(distPath, 'acorn.wasm'), path.join(outputPath, 'acorn.wasm')],
    [
      path.join(distPath, 'parsers', 'gradle', 'dependency-tree.init.gradle'),
      path.join(outputPath, 'parsers', 'gradle', 'dependency-tree.init.gradle'),
    ],
    [
      path.join(packagePath, 'LICENSE'),
      path.join(outputPath, 'LICENSE.sdxgen'),
    ],
  ]
}

export async function copySdxgenAssets(root: string): Promise<void> {
  const require = createRequire(import.meta.url)
  const outputPath = path.join(root, 'dist')
  const copies = getSdxgenAssetCopies(require.resolve('sdxgen'), outputPath)
  const results = await Promise.allSettled(
    copies.map(async ([source, destination]) => {
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.copyFile(source, destination)
    }),
  )
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    throw failed.reason
  }
}
