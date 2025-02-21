import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync
} from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { globSync as tinyGlobSync } from 'tinyglobby'

import { toSortedObject } from '@socketsecurity/registry/lib/objects'
import {
  isValidPackageName,
  readPackageJsonSync
} from '@socketsecurity/registry/lib/packages'
import { isRelative } from '@socketsecurity/registry/lib/path'

import baseConfig from './rollup.base.config.mjs'
import constants from '../scripts/constants.js'
import socketModifyPlugin from '../scripts/rollup/socket-modify-plugin.js'
import { readJsonSync } from '../scripts/utils/fs.js'
import { formatObject } from '../scripts/utils/objects.js'
import {
  getPackageName,
  isBuiltin,
  normalizeId
} from '../scripts/utils/packages.js'
import { envAsBoolean } from '@socketsecurity/registry/lib/env'
import assert from 'node:assert'

const {
  BABEL_RUNTIME,
  CONSTANTS,
  MODULE_SYNC,
  REQUIRE,
  ROLLUP_EXTERNAL_SUFFIX,
  VENDOR,
  depStatsPath,
  rootDistPath,
  rootPath,
  rootSrcPath
} = constants

const CONSTANTS_JS = `${CONSTANTS}.js`
const CONSTANTS_STUB_CODE = createStubCode(`../${CONSTANTS_JS}`)
const VENDOR_JS = `${VENDOR}.js`

const IS_SENTRY_BUILD = envAsBoolean(process.env['SOCKET_WITH_SENTRY']);
const IS_PUBLISH = envAsBoolean(process.env['SOCKET_IS_PUBLISHED'])

const distConstantsPath = path.join(rootDistPath, CONSTANTS_JS)
const distModuleSyncPath = path.join(rootDistPath, MODULE_SYNC)
const distRequirePath = path.join(rootDistPath, REQUIRE)

const editablePkgJson = readPackageJsonSync(rootPath, { editable: true })

const processEnvTapRegExp =
  /\bprocess\.env(?:\.TAP|\[['"]TAP['"]\])(\s*\?[^:]+:\s*)?/g
const processEnvSocketIsPublishedRegExp =
  /\bprocess\.env(?:\.SOCKET_IS_PUBLISHED|\[['"]SOCKET_IS_PUBLISHED['"]\])/g
const processEnvSocketCliVersionRegExp =
  /\bprocess\.env(?:\.SOCKET_CLI_VERSION|\[['"]SOCKET_CLI_VERSION['"]\])/g

function createStubCode(relFilepath) {
  return `'use strict'\n\nmodule.exports = require('${relFilepath}')\n`
}

function moveDtsFilesSync(namePattern, srcPath, destPath) {
  for (const filepath of tinyGlobSync([`**/${namePattern}.d.ts{.map,}`], {
    absolute: true,
    cwd: srcPath
  })) {
    copyFileSync(filepath, path.join(destPath, path.basename(filepath)))
    rmSync(filepath)
  }
}

function copyInitGradle() {
  const filepath = path.join(rootSrcPath, 'commands/manifest/init.gradle')
  const destPath = path.join(rootDistPath, 'init.gradle')
  copyFileSync(filepath, destPath)
}

function removeDtsFilesSync(namePattern, srcPath) {
  for (const filepath of tinyGlobSync([`**/${namePattern}.d.ts{.map,}`], {
    absolute: true,
    cwd: srcPath
  })) {
    rmSync(filepath)
  }
}

function updateDepStatsSync(depStats) {
  const { content: pkgJson } = editablePkgJson
  const oldDepStats = existsSync(depStatsPath)
    ? readJsonSync(depStatsPath)
    : undefined
  Object.assign(depStats.dependencies,
    // Add existing package.json dependencies without old transitives. This
    // preserves dependencies like '@cyclonedx/cdxgen' and 'synp' that are
    // indirectly referenced through spawned processes and not directly imported.
    Object.fromEntries(
      Object.entries(pkgJson.dependencies).filter(
        ({ 0: key }) => !oldDepStats?.transitives?.[key]
      )
    ))
  // Remove transitives from dependencies.
  for (const key of Object.keys(oldDepStats?.transitives ?? {})) {
    if (pkgJson.dependencies[key]) {
      depStats.transitives[key] = pkgJson.dependencies[key]
      depStats.external[key] = pkgJson.dependencies[key]
      delete depStats.dependencies[key]
    }
  }

  assert(Object.keys(editablePkgJson?.content?.bin).join(',') === 'socket,socket-npm,socket-npx', 'If this fails, make sure to update the rollup sentry override for .bin to match the regular build!');
  if (IS_SENTRY_BUILD) {
    editablePkgJson.content['name'] = '@socketsecurity/socket-with-sentry'
    editablePkgJson.content['description'] = "CLI tool for Socket.dev, includes Sentry error handling, otherwise identical to the regular `socket` package"
    editablePkgJson.content['bin'] = {
      "socket-with-sentry": "bin/cli.js",
      "socket-npm-with-sentry": "bin/npm-cli.js",
      "socket-npx-with-sentry": "bin/npx-cli.js"
    }
    // Add Sentry as a regular dep for this build
    depStats.dependencies['@sentry/node'] = '9.1.0';
  }

  depStats.dependencies = toSortedObject(depStats.dependencies)
  depStats.devDependencies = toSortedObject(depStats.devDependencies)
  depStats.esm = toSortedObject(depStats.esm)
  depStats.external = toSortedObject(depStats.external)
  depStats.transitives = toSortedObject(depStats.transitives)
  // Write dep stats.
  writeFileSync(depStatsPath, `${formatObject(depStats)}\n`, 'utf8')

  // Update dependencies with additional inlined modules.
  editablePkgJson
    .update({
      dependencies: {
        ...depStats.dependencies,
        ...depStats.transitives
      }
    })
    .saveSync()

  if (IS_SENTRY_BUILD) {
    // Replace the name in the package lock too, just in case.
    const lock = readFileSync('package-lock.json', 'utf8');
    // Note: this should just replace the first occurrence, even if there are more
    const lock2 = lock.replace('"name": "socket",', '"name": "@socketsecurity/socket-with-sentry",')
    writeFileSync('package-lock.json', lock2)
  }
}

function versionBanner(_chunk) {
  let pkgJsonVersion = 'unknown';
  try { pkgJsonVersion = JSON.parse(readFileSync('package.json', 'utf8'))?.version ?? 'unknown' } catch {}

  let gitHash = ''
  try {
    const obj = spawnSync('git', ['rev-parse','--short', 'HEAD']);
    if (obj.stdout) {
      gitHash = obj.stdout.toString('utf8').trim()
    }
  } catch {}

  // Make each build generate a unique version id, regardless
  // Mostly for development: confirms the build refreshed. For prod
  // builds the git hash should suffice to identify the build.
  const rng = randomUUID().split('-')[0];

  return `
    var SOCKET_CLI_PKG_JSON_VERSION = "${pkgJsonVersion}"
    var SOCKET_CLI_GIT_HASH = "${gitHash}"
    var SOCKET_CLI_BUILD_RNG = "${rng}"
    var SOCKET_PUB = ${IS_PUBLISH}
    var SOCKET_CLI_VERSION = "${pkgJsonVersion}:${gitHash}:${rng}${IS_PUBLISH ? ':pub':''}"
  `.trim().split('\n').map(s => s.trim()).join('\n')
}

export default () => {
  const moduleSyncConfig = baseConfig({
    input: {
      cli: `${rootSrcPath}/cli.ts`,
      constants: `${rootSrcPath}/constants.ts`,
      'shadow-bin': `${rootSrcPath}/shadow/shadow-bin.ts`,
      'npm-injection': `${rootSrcPath}/shadow/npm-injection.ts`
    },
    output: [
      {
        intro: versionBanner, // Note: "banner" would defeat "use strict"
        dir: path.relative(rootPath, distModuleSyncPath),
        entryFileNames: '[name].js',
        exports: 'auto',
        externalLiveBindings: false,
        format: 'cjs',
        freeze: false,
        sourcemap: true,
        sourcemapDebugIds: true,
      }
    ],
    external(id_) {
      if (id_.endsWith(ROLLUP_EXTERNAL_SUFFIX) || isBuiltin(id_)) {
        return true
      }
      const id = normalizeId(id_)
      const name = getPackageName(id)
      if (
        name === BABEL_RUNTIME ||
        id.startsWith(rootSrcPath) ||
        id.endsWith('.mjs') ||
        id.endsWith('.mts') ||
        isRelative(id) ||
        !isValidPackageName(name)
      ) {
        return false
      }
      return true
    },
    plugins: [
      {
        generateBundle(_options, bundle) {
          const data = bundle[CONSTANTS_JS]
          if (data?.type === 'chunk') {
            data.code = CONSTANTS_STUB_CODE
          }
        },
        writeBundle() {
          removeDtsFilesSync(CONSTANTS, distModuleSyncPath)
        }
      }
    ]
  })

  const requireConfig = baseConfig({
    input: {
      cli: `${rootSrcPath}/cli.ts`,
      constants: `${rootSrcPath}/constants.ts`,
      'shadow-bin': `${rootSrcPath}/shadow/shadow-bin.ts`,
      'npm-injection': `${rootSrcPath}/shadow/npm-injection.ts`
    },
    output: [
      {
        intro: versionBanner, // Note: "banner" would defeat "use strict"
        dir: path.relative(rootPath, distRequirePath),
        entryFileNames: '[name].js',
        exports: 'auto',
        externalLiveBindings: false,
        format: 'cjs',
        freeze: false,
        sourcemap: true,
        sourcemapDebugIds: true,
      }
    ],
    plugins: [
      // When process.env['TAP'] is found either remove it, if part of a ternary
      // operation, or replace it with `false`.
      socketModifyPlugin({
        find: processEnvTapRegExp,
        replace: (_match, ternary) => (ternary ? '' : 'false')
      }),
      // Replace `process.env.SOCKET_IS_PUBLISHED` with a boolean
      socketModifyPlugin({
        find: processEnvSocketIsPublishedRegExp,
        // Note: these are going to be bools in JS, not strings
        replace: () => (IS_PUBLISH ? 'true' : 'false')
      }),
      // Replace `process.env.SOCKET_CLI_VERSION` with var ref that rollup
      // adds to the top of each file.
      socketModifyPlugin({
        find: processEnvSocketCliVersionRegExp,
        replace: 'SOCKET_CLI_VERSION'
      }),

      {
        generateBundle(_options, bundle) {
          for (const basename of Object.keys(bundle)) {
            const data = bundle[basename]
            if (data.type === 'chunk') {
              if (basename === CONSTANTS_JS) {
                mkdirSync(rootDistPath, { recursive: true })
                writeFileSync(distConstantsPath, data.code, 'utf8')
                data.code = CONSTANTS_STUB_CODE
              } else if (
                basename !== VENDOR_JS &&
                !data.code.includes(`'./${VENDOR_JS}'`)
              ) {
                data.code = createStubCode(`../${MODULE_SYNC}/${basename}`)
              }
            }
          }
        },
        writeBundle() {
          moveDtsFilesSync(CONSTANTS, distRequirePath, rootDistPath)
          copyInitGradle()
          removeDtsFilesSync('*', distRequirePath)
          updateDepStatsSync(requireConfig.meta.depStats)
        }
      }
    ]
  })

  return [moduleSyncConfig, requireConfig]
}
