/**
 * Bundle-stub offer for the optimize command. When a project bundles with
 * rolldown, esbuild, or rollup, the static analyzer keeps subgraphs that the
 * runtime never reaches (the fleet's `bundle-stub` case: globs.js →
 * picomatch, sorts.js → semver + npm-pack). The offer tells the operator the
 * stub plugin exists and shows the wiring for THEIR bundler — the same
 * optimization the wheelhouse fleet members apply via
 * `.config/fleet/rolldown/bundle-stub.mts`.
 *
 * Key Functions: - detectBundler: which bundler the project builds with.
 * - bundleStubOffer: the advisory block, or undefined when no bundler shows.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { debugDir } from '@socketsecurity/lib-stable/debug/output'

export type Bundler = 'esbuild' | 'rolldown' | 'rollup'

export type BundleStubOffer = {
  bundler: Bundler
  snippet: string
  summary: string
}

const ROLLDOWN_SNIPPET = `import { createBundleStubPlugin } from './.config/fleet/rolldown/bundle-stub.mts'

export default {
  plugins: [
    createBundleStubPlugin({
      // Regex against resolved module paths proven unreachable at runtime.
      stubPattern: /node_modules\\/some-lib\\/heavy-subgraph\\.js$/,
    }),
  ],
}`

const ESBUILD_SNIPPET = `const stubUnused = {
  name: 'stub-unused-lib-internals',
  setup(build) {
    // Regex against module paths proven unreachable at runtime.
    build.onLoad({ filter: /node_modules\\/some-lib\\/heavy-subgraph\\.js$/ },
      () => ({ contents: 'module.exports = {}' }))
  },
}`

const ROLLUP_SNIPPET = `function createBundleStubPlugin({ stubPattern, stubCode = 'module.exports = {}' }) {
  return {
    name: 'stub-unused-lib-internals',
    load(id) {
      return stubPattern.test(id)
        ? { code: stubCode, moduleSideEffects: false }
        : undefined
    },
  }
}`

const SNIPPETS: Readonly<Record<Bundler, string>> = {
  esbuild: ESBUILD_SNIPPET,
  rolldown: ROLLDOWN_SNIPPET,
  rollup: ROLLUP_SNIPPET,
}

/**
 * The advisory block for the detected bundler, or undefined when the project
 * shows no bundler. The safety rule rides every offer: stub only modules
 * PROVEN unreachable — stubbing a module the runtime reaches produces
 * runtime crashes, not bundle-time errors (the rebuild → test loop from the
 * fleet's trimming-bundle skill).
 */
export function bundleStubOffer(
  root: string | undefined,
): BundleStubOffer | undefined {
  if (typeof root !== 'string' || root.length === 0) {
    debugDir({ bundleStubOffer: 'no project path' })
    return undefined
  }
  const bundler = detectBundler(root)
  if (bundler === undefined) {
    debugDir({ bundleStubOffer: 'no bundler detected' })
    return undefined
  }
  return {
    bundler,
    snippet: SNIPPETS[bundler],
    summary:
      `This project bundles with ${bundler}. Its bundle can shrink further: ` +
      'stub heavyweight modules the static analyzer keeps but the runtime ' +
      'never reaches. Add the stub only after proving the path unreachable ' +
      '(stub → rebuild → test), or the trim fails at RUNTIME, not at build time.',
  }
}

/**
 * Which bundler the project builds with, from config files first and the
 * package.json script bodies as the fallback. Undefined when nothing points
 * at a bundler — the offer stays silent there.
 */
export function detectBundler(root: string): Bundler | undefined {
  const rolldownConfigs = [
    '.config/rolldown.build.mts',
    'rolldown.config.mjs',
    'rolldown.config.mts',
  ]
  for (let i = 0, { length } = rolldownConfigs; i < length; i += 1) {
    const rel = rolldownConfigs[i]!
    if (existsSync(path.join(root, rel))) {
      return 'rolldown'
    }
  }
  const rollupConfigs = [
    'rollup.config.js',
    'rollup.config.mjs',
    'rollup.config.ts',
  ]
  for (let i = 0, { length } = rollupConfigs; i < length; i += 1) {
    const rel = rollupConfigs[i]!
    if (existsSync(path.join(root, rel))) {
      return 'rollup'
    }
  }
  const scripts = readPackageScripts(root)
  if (/\brolldown\b/.test(scripts)) {
    return 'rolldown'
  }
  if (/\besbuild\b/.test(scripts)) {
    return 'esbuild'
  }
  if (/\brollup\b/.test(scripts)) {
    return 'rollup'
  }
  return undefined
}

export function readPackageScripts(root: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8'),
    )
    return JSON.stringify(pkg['scripts'] ?? {})
  } catch {
    return ''
  }
}
