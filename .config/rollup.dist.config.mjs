import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hasKeys, toSortedObject } from '@socketsecurity/registry/lib/objects'

import { readJsonSync } from '../scripts/utils/fs.js'
import { formatObject } from '../scripts/utils/objects.js'
import { readPackageJsonSync } from '../scripts/utils/packages.js'

import baseConfig from './rollup.base.config.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const rootPath = path.resolve(__dirname, '..')
const depStatsPath = path.join(rootPath, '.dep-stats.json')
const distPath = path.join(rootPath, 'dist')
const srcPath = path.join(rootPath, 'src')

const pkgJsonPath = path.resolve(rootPath, 'package.json')
const pkgJson = readPackageJsonSync(pkgJsonPath)

export default () => {
  const config = baseConfig({
    input: {
      cli: `${srcPath}/cli.ts`,
      'npm-cli': `${srcPath}/shadow/npm-cli.ts`,
      'npx-cli': `${srcPath}/shadow/npx-cli.ts`,
      'npm-injection': `${srcPath}/shadow/npm-injection.ts`
    },
    output: [
      {
        dir: 'dist',
        entryFileNames: '[name].js',
        format: 'cjs',
        exports: 'auto',
        externalLiveBindings: false,
        freeze: false
      }
    ],
    plugins: [
      {
        writeBundle() {
          const { '@cyclonedx/cdxgen': cdxgenRange, synp: synpRange } =
            pkgJson.dependencies
          const { depStats } = config.meta

          // Manually add @cyclonedx/cdxgen and synp as they are not directly
          // referenced in the code but used through spawned processes.
          depStats.dependencies['@cyclonedx/cdxgen'] = cdxgenRange
          depStats.dependencies.synp = synpRange
          depStats.external['@cyclonedx/cdxgen'] = cdxgenRange
          depStats.external.synp = synpRange

          try {
            // Remove transitives from dependencies
            const oldDepStats = readJsonSync(depStatsPath)
            for (const key of Object.keys(oldDepStats.transitives)) {
              if (pkgJson.dependencies[key]) {
                depStats.transitives[key] = pkgJson.dependencies[key]
                depStats.external[key] = pkgJson.dependencies[key]
                delete depStats.dependencies[key]
              }
            }
          } catch {}

          depStats.dependencies = toSortedObject(depStats.dependencies)
          depStats.devDependencies = toSortedObject(depStats.devDependencies)
          depStats.esm = toSortedObject(depStats.esm)
          depStats.external = toSortedObject(depStats.external)
          depStats.transitives = toSortedObject(depStats.transitives)

          // Write dep stats
          writeFileSync(depStatsPath, `${formatObject(depStats)}\n`, 'utf8')

          // Make dist files chmod +x
          chmodSync(path.join(distPath, 'cli.js'), 0o755)
          chmodSync(path.join(distPath, 'npm-cli.js'), 0o755)
          chmodSync(path.join(distPath, 'npx-cli.js'), 0o755)

          // Update dependencies with additional inlined modules
          writeFileSync(
            pkgJsonPath,
            readFileSync(pkgJsonPath, 'utf8').replace(
              /(?<="dependencies":\s*)\{[^\}]*\}/,
              () => {
                const deps = {
                  ...depStats.dependencies,
                  ...depStats.transitives
                }
                const formatted = formatObject(deps, 4)
                return hasKeys(deps) ? formatted.replace('}', '  }') : formatted
              }
            ),
            'utf8'
          )
        }
      }
    ]
  })

  return config
}
