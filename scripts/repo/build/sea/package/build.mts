import { mkdir, writeFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { isMainModule } from '../../../../fleet/process/is-main-module.mts'
import { runMain } from '../../../../fleet/process/main/run.mts'
import { PACKAGE_ROOT } from '../../paths.mts'
import { rolldown } from 'rolldown'

const ENTRY_PATH = path.join(
  PACKAGE_ROOT,
  'scripts/repo/build/sea/package/run.mts',
)
const DEFAULT_OUTPUT_PATH = path.join(
  PACKAGE_ROOT,
  'build/sea/package-check.generated.mjs',
)

export async function buildNativePackageVerifier(
  options: {
    outputPath?: string | undefined
  } = {},
): Promise<string> {
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH
  const bundle = await rolldown({
    input: ENTRY_PATH,
    platform: 'node',
    transform: { target: 'node20' },
    external: id =>
      builtinModules.includes(id) ||
      (id.startsWith('node:') && builtinModules.includes(id.slice(5))),
    onLog(level, log, handler) {
      if (log.code === 'UNRESOLVED_IMPORT') {
        throw new Error(
          `Verifier bundle has an unresolved import: ${log.message}`,
        )
      }
      handler(level, log)
    },
  })
  try {
    const generated = await bundle.generate({
      format: 'es',
      // oxlint-disable-next-line socket/no-minified-bundler-output -- This standalone CI verifier is a generated transport bundle.
      minify: true,
      sourcemap: false,
    })
    for (const output of generated.output) {
      if (output.type === 'chunk') {
        for (const imported of [...output.imports, ...output.dynamicImports]) {
          const name = imported.startsWith('node:')
            ? imported.slice(5)
            : imported
          if (!builtinModules.includes(name)) {
            throw new Error(
              `Verifier bundle has a non-builtin import: ${imported}`,
            )
          }
        }
      }
    }
    await mkdir(path.dirname(outputPath), { recursive: true })
    const chunk = generated.output.find(output => output.type === 'chunk')
    if (generated.output.length !== 1 || !chunk || !chunk.isEntry) {
      throw new Error('Verifier bundle did not emit an entry chunk.')
    }
    await writeFile(outputPath, chunk.code)
    return outputPath
  } finally {
    await bundle.close()
  }
}

export async function main(): Promise<void> {
  const outputPath = await buildNativePackageVerifier()
  process.stdout.write(`Built native package verifier: ${outputPath}\n`)
}

const SCRIPT_META = {
  describe: 'build the standalone native package verifier',
  heavyJob: 'build' as const,
  help: 'Usage: pnpm run build:native:verifier',
  json: 'result' as const,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
