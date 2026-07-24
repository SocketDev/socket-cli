/**
 * Rolldown configuration for building Socket CLI as a single unified file.
 * Replaces the esbuild config (fleet "Tooling" rule: bundler = rolldown).
 *
 * The two output-text transforms esbuild ran as `onEnd` plugins
 * (unicode-property-escape + env-var replacement) move to post-write passes in
 * `runBuild` (see rolldown-utils.mts). The three resolve/stub plugins port to
 * rolldown `resolveId` / `load` hooks below.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { IMPORT_META_URL_BANNER } from 'build-infra/lib/esbuild-helpers'

import {
  createBaseConfig,
  getInlinedEnvVars,
  runBuild,
} from '../scripts/rolldown-utils.mts'

import type { Plugin, RolldownOptions } from 'rolldown'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

const inlinedEnvVars = getInlinedEnvVars()

// Matches ./external/, ../external/, ../../external/, etc. (forward + back slash).
const socketLibExternalPathRegExp = /^(?:(?:\.\.[/\\])+|\.[/\\])external[/\\]/

/**
 * Collapse symlinked module ids (pnpm `@socketsecurity/lib` + `lib-stable`
 * aliases both point at one real package) to the physical path. Without this,
 * the same prebundled external (e.g. npm-pack.js) enters the module graph
 * under two ids, gets bundled twice, and rolldown's identifier deconflicting
 * collides on the prebundles' pre-suffixed `require_lib$N` names — at runtime
 * Arborist's `pacote` binding then resolves to a different chunk's module
 * ("pacote.manifest is not a function" during dlx installs).
 */
function toRealPath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

export function findSocketLibPath(importerPath: string): string | undefined {
  const match = importerPath.match(/^(.*\/@socketsecurity\/lib)\b/)
  if (match) {
    return match[1]
  }
  const localPath = path.join(rootPath, '..', '..', '..', 'socket-lib')
  if (existsSync(localPath)) {
    return localPath
  }
  return undefined
}

export function resolveSocketLibExternal(
  socketLibPath: string,
  packageName: string,
): string | undefined {
  if (packageName.startsWith('@')) {
    const parts = packageName.split('/')
    const scope = parts[0]
    const name = parts[1]
    const p = path.join(socketLibPath, 'dist', 'external', scope, `${name}.js`)
    return existsSync(p) ? p : undefined
  }
  const p = path.join(
    socketLibPath,
    'dist',
    'external',
    `${packageName.split('/')[0]}.js`,
  )
  return existsSync(p) ? p : undefined
}

/**
 * Resolve socket-lib's internal `../constants/*` + `../external/*` specifiers
 * (and bare package re-exports from inside socket-lib's dist) to the prebuilt
 * files in socket-lib's dist tree. Ported from the esbuild onResolve plugin to
 * a rolldown `resolveId` hook (importer-aware, same filters).
 */
// An importer is "inside socket-lib's dist" whether it resolved through the
// canonical `@socketsecurity/lib`, the `-stable` npm: alias, or a local
// `/socket-lib/` checkout. rolldown resolves the alias to the real
// `@socketsecurity/lib/dist/` path; esbuild saw the `-stable` form.
function isSocketLibDistImporter(importer: string | undefined): boolean {
  return (
    !!importer &&
    (importer.includes('@socketsecurity/lib/dist/') ||
      importer.includes('@socketsecurity/lib-stable/dist/') ||
      importer.includes('/socket-lib/dist/'))
  )
}

function resolveSocketLibInternalsPlugin(): Plugin {
  function resolveConstant(
    source: string,
    importer: string | undefined,
    strip: RegExp,
  ): { id: string } | undefined {
    if (!isSocketLibDistImporter(importer)) {
      return undefined
    }
    const socketLibPath = findSocketLibPath(importer)
    if (!socketLibPath) {
      return undefined
    }
    const p = path.join(
      socketLibPath,
      'dist',
      'constants',
      `${source.replace(strip, '')}.js`,
    )
    return existsSync(p) ? { id: toRealPath(p) } : undefined
  }
  return {
    name: 'resolve-socket-lib-internals',
    // socket-lib's prebundled dist files carry bundler-generated CJS factory
    // names like `require_lib$36`. When rolldown flattens several of those
    // files into one output scope it deconflicts colliding names by appending
    // its own `$N` suffixes — and a generated name (`require_lib$10`) can
    // collide with a DIFFERENT file's pre-existing `require_lib$10`, silently
    // rebinding e.g. Arborist's `pacote` to libnpmpack ("pacote.manifest is
    // not a function" during dlx installs). Rewrite the pre-suffixed factory
    // names (file-internal, never imported across files) to a `$`-free form
    // so the deconflicter can't generate a colliding name.
    load(id) {
      if (
        /[/\\]@socketsecurity[/\\]lib(?:-stable)?[/\\]dist[/\\]|[/\\]socket-lib[/\\]dist[/\\]/.test(
          id,
        ) &&
        id.endsWith('.js')
      ) {
        const code = readFileSync(id, 'utf8')
        return {
          // Matches a whole CJS factory name: `require_` + identifier chars
          // (captured as $1), then a literal `$` + digits (the bundler's
          // numeric suffix, captured as $2), e.g. `require_lib$36`.
          code: code.replace(/\b(require_[A-Za-z_][\w]*)\$(\d+)\b/g, '$1_v$2'),
        }
      }
      return undefined
    },
    resolveId(source, importer) {
      if (source.startsWith('../constants/')) {
        return resolveConstant(source, importer, /^\.\.\/constants\//)
      }
      if (source.startsWith('../../constants/')) {
        return resolveConstant(source, importer, /^\.\.\/\.\.\/constants\//)
      }
      if (socketLibExternalPathRegExp.test(source)) {
        if (!isSocketLibDistImporter(importer)) {
          return undefined
        }
        const socketLibPath = findSocketLibPath(importer)
        if (!socketLibPath) {
          return undefined
        }
        const externalPath = source
          .replace(socketLibExternalPathRegExp, '')
          .replace(/\.js$/, '')
        const p = resolveSocketLibExternal(socketLibPath, externalPath)
        return p ? { id: toRealPath(p) } : undefined
      }
      // Source is a bare-package or scoped-package specifier:
      // ^               anchors to start of string
      // @[^/]+\/[^/]+   scoped name like `@scope/pkg` — `@` + non-slash chars + `/` + non-slash chars
      // |               or
      // [^./][^/]*      bare name — starts with a non-dot non-slash char, then any non-slash chars
      if (/^(?:@[^/]+\/[^/]+|[^./][^/]*)/.test(source)) {
        if (!isSocketLibDistImporter(importer)) {
          return undefined
        }
        const socketLibPath = findSocketLibPath(importer)
        if (!socketLibPath) {
          return undefined
        }
        const packageName = source.startsWith('@')
          ? source.split('/').slice(0, 2).join('/')
          : source.split('/')[0]
        const p = resolveSocketLibExternal(socketLibPath, packageName)
        return p ? { id: toRealPath(p) } : undefined
      }
      return undefined
    },
  }
}

/**
 * Stub iconv-lite + encoding (bundling-problematic, unused at runtime). Ported
 * from the esbuild onResolve+onLoad namespace pattern to rolldown `resolveId`
 * (tag with a `\0stub:` id) + `load` (return empty CJS).
 */
function stubProblematicPackagesPlugin(): Plugin {
  const prefix = '\0stub-empty:'
  return {
    name: 'stub-problematic-packages',
    resolveId(source) {
      // Source is the `encoding` or `iconv-lite` package, or a subpath of either:
      // ^                       anchors to start of string
      // (?:encoding|iconv-lite) matches exactly one of the two package names
      // (?:$|\/)                end of string (bare name) or `/` (subpath like `iconv-lite/stream`)
      if (/^(?:encoding|iconv-lite)(?:$|\/)/.test(source)) {
        return { id: `${prefix}${source}` }
      }
      return undefined
    },
    load(id) {
      if (id.startsWith(prefix)) {
        return { code: 'module.exports = {}', moduleSideEffects: false }
      }
      return undefined
    },
  }
}

/**
 * Mark @npmcli/arborist + node-gyp external (arborist is huge + optionally
 * resolved; node-gyp is conditionally required). Ported from the esbuild
 * onResolve `external: true` plugin to a rolldown `resolveId` external return.
 */
function ignoreUnsupportedFilesPlugin(): Plugin {
  return {
    name: 'ignore-unsupported-files',
    resolveId(source, importer) {
      if (/@npmcli\/arborist/.test(source)) {
        // Don't externalize when it comes from socket-lib's own external bundle.
        if (importer?.includes('/socket-lib/dist/')) {
          return undefined
        }
        return { id: source, external: true }
      }
      if (/node-gyp/.test(source)) {
        return { id: source, external: true }
      }
      return undefined
    },
  }
}

const baseConfig = createBaseConfig(inlinedEnvVars)

const config: RolldownOptions = {
  ...baseConfig,
  input: path.join(rootPath, 'src/cli-dispatch.mts'),
  // .cs files (node-gyp on Windows) resolve to empty.
  moduleTypes: { '.cs': 'empty' },
  transform: {
    ...baseConfig.transform,
    define: {
      ...baseConfig.transform?.define,
      'import.meta.url': '__importMetaUrl',
    },
  },
  plugins: [
    resolveSocketLibInternalsPlugin(),
    stubProblematicPackagesPlugin(),
    ignoreUnsupportedFilesPlugin(),
  ],
  output: {
    file: path.join(rootPath, 'build/cli.js'),
    format: 'cjs',
    minify: false,
    sourcemap: false,
    keepNames: true,
    // Single self-contained CLI file: inline dynamic imports into one chunk so
    // `output.file` is valid (esbuild emitted one outfile by default).
    codeSplitting: false,
    banner: `#!/usr/bin/env node\n"use strict";\n${IMPORT_META_URL_BANNER.js}`,
  },
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  // The unicode + env-var post-write transforms run here (rolldown can't
  // express them as config), matching the esbuild onEnd plugin order.
  runBuild(config, 'CLI bundle', {
    envVars: inlinedEnvVars,
    unicodeTransform: true,
  }).catch(() => {
    process.exitCode = 1
  })
}

export default config
